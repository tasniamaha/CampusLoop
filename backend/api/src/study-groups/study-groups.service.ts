import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { CreateStudyGroupDto } from './dto/create-study-group.dto.js';
import { ListStudyGroupsQueryDto } from './dto/list-study-groups-query.dto.js';
import { StudyGroup, StudyGroupStatus } from './entities/study-group.entity.js';
import { StudyGroupMember, StudyGroupMemberRole, StudyGroupMemberStatus } from './entities/study-group-member.entity.js';

const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const normalizeCampus = (campus: string): string => {
  const normalized = campus.trim().toLowerCase().replace(/\s+/g, ' ');

  const aliases: Record<string, string> = {
    iut: 'IUT',
    'islamic university of technology': 'IUT',
  };

  return aliases[normalized] ?? campus.trim();
};
/** "My groups" returns at most this many per section, newest first, plus a `truncated` flag. */
export const MY_LIST_LIMIT = 100;
@Injectable()
export class StudyGroupsService {
  constructor(
    @InjectRepository(StudyGroup) private readonly groups: Repository<StudyGroup>,
    @InjectRepository(StudyGroupMember) private readonly members: Repository<StudyGroupMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}
 private async campusFor(userId: string): Promise<string> {
  const user = await this.users.findOne({
    where: { id: userId },
    select: { id: true, campus: true },
  });

  if (!user) {
    throw new NotFoundException('Account not found');
  }

  return normalizeCampus(user.campus);
}
  private async getGroup(id: string, campus: string): Promise<StudyGroup> {
    const group = await this.groups.findOne({ where: { id, campus } });
    if (!group) throw new NotFoundException('Study group not found');
    return group;
  }
  /**
   * Same-campus group the viewer may see. Archived groups are visible only to their creator and
   * active members; everyone else gets the same 404 as for a group that doesn't exist.
   */
  private async getVisibleGroup(id: string, userId: string, campus: string): Promise<StudyGroup> {
    const group = await this.getGroup(id, campus);
    if (group.status === StudyGroupStatus.ARCHIVED && group.creatorId !== userId) {
      const active = await this.members.findOne({ where: { groupId: id, userId, status: StudyGroupMemberStatus.ACTIVE } });
      if (!active) throw new NotFoundException('Study group not found');
    }
    return group;
  }
  /** Adds member count and the viewer's own membership. Two queries for any number of groups. */
  private async groupViews(groups: StudyGroup[], userId: string) {
    if (!groups.length) return [];
    const ids = groups.map((group) => group.id);
    const [counts, mine] = await Promise.all([
      this.members
        .createQueryBuilder('m')
        .select('m.groupId', 'groupId')
        .addSelect('COUNT(*)', 'count')
        .where('m.groupId IN (:...ids)', { ids })
        .andWhere('m.status = :status', { status: StudyGroupMemberStatus.ACTIVE })
        .groupBy('m.groupId')
        .getRawMany<{ groupId: string; count: string | number }>(),
      this.members.find({ where: { groupId: In(ids), userId } }),
    ]);
    const countById = new Map(counts.map((row) => [row.groupId, Number(row.count)]));
    const mineById = new Map(mine.map((row) => [row.groupId, row]));
    return groups.map((group) => {
      const own = mineById.get(group.id);
      return { ...group, memberCount: countById.get(group.id) ?? 0, isCreator: group.creatorId === userId, myMembershipStatus: own?.status ?? null, myMembershipRole: own?.role ?? null };
    });
  }
  private async groupView(group: StudyGroup, userId: string) {
    return (await this.groupViews([group], userId))[0];
  }
  async list(userId: string, query: ListStudyGroupsQueryDto) {
    const campus = await this.campusFor(userId);
    const page = query.page ?? 1, limit = query.limit ?? 20;
    const qb = this.groups.createQueryBuilder('g').where('g.campus = :campus', { campus }).andWhere('g.status = :status', { status: StudyGroupStatus.OPEN });
if (query.courseCode?.trim()) {
  qb.andWhere('LOWER(g.courseCode) LIKE LOWER(:courseCode)', {
    courseCode: `%${query.courseCode.trim()}%`,
  });
}    if (query.topic?.trim()) qb.andWhere('LOWER(g.topic) LIKE LOWER(:topic)', { topic: `%${query.topic.trim()}%` });
    const [rows, total] = await qb.orderBy('g.createdAt', 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount();
    return { data: await this.groupViews(rows, userId), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
  async create(userId: string, dto: CreateStudyGroupDto) {
    const campus = await this.campusFor(userId);
    const group = await this.dataSource.transaction(async (manager) => {
      const groups = manager.getRepository(StudyGroup), members = manager.getRepository(StudyGroupMember);
      const created = await groups.save(groups.create({ creatorId: userId, campus, title: clean(dto.title), courseCode: clean(dto.courseCode).toUpperCase(), topic: clean(dto.topic), description: dto.description.trim(), schedule: clean(dto.schedule), participantLimit: dto.participantLimit, approvalRequired: dto.approvalRequired ?? true, status: StudyGroupStatus.OPEN }));
      await members.save(members.create({ groupId: created.id, userId, campus, role: StudyGroupMemberRole.OWNER, status: StudyGroupMemberStatus.ACTIVE, reviewedAt: new Date() }));
      return created;
    });
    return this.groupView(group, userId);
  }
  async get(groupId: string, userId: string) {
    const campus = await this.campusFor(userId);
    return this.groupView(await this.getVisibleGroup(groupId, userId, campus), userId);
  }
  /**
   * The caller's own study-group activity on their campus, built only from their own membership
   * rows: groups they created (open or archived), groups they're an active member of, and their
   * pending/rejected join requests. A request to a group that has since been archived carries only
   * a minimal summary, since the requester can no longer open that group.
   */
  async mine(userId: string) {
    const campus = await this.campusFor(userId);
    const viaOwnRow = (condition: string, params: Record<string, unknown>) =>
      this.groups
        .createQueryBuilder('g')
        .innerJoin(StudyGroupMember, 'm', `m.groupId = g.id AND m.userId = :userId AND ${condition}`, { userId, ...params })
        .where('g.campus = :campus', { campus });
    const [[created, createdTotal], [joined, joinedTotal], [requests, requestsTotal]] = await Promise.all([
      viaOwnRow('m.role = :owner', { owner: StudyGroupMemberRole.OWNER })
        .orderBy('g.createdAt', 'DESC')
        .limit(MY_LIST_LIMIT)
        .getManyAndCount(),
      viaOwnRow('m.role = :member AND m.status = :active', { member: StudyGroupMemberRole.MEMBER, active: StudyGroupMemberStatus.ACTIVE })
        .orderBy('m.createdAt', 'DESC')
        .limit(MY_LIST_LIMIT)
        .getManyAndCount(),
      this.members
        .createQueryBuilder('m')
        .innerJoin(StudyGroup, 'g', 'g.id = m.groupId AND g.campus = :campus', { campus })
        .where('m.userId = :userId', { userId })
        .andWhere('m.status IN (:...statuses)', { statuses: [StudyGroupMemberStatus.PENDING, StudyGroupMemberStatus.REJECTED] })
        .orderBy('m.createdAt', 'DESC') // not updatedAt: TypeORM rewrites it at second precision on update
        .limit(MY_LIST_LIMIT)
        .getManyAndCount(),
    ]);
    const requestedGroups = requests.length ? await this.groups.find({ where: { id: In(requests.map((row) => row.groupId)) } }) : [];
    const [createdViews, joinedViews, openViews] = await Promise.all([
      this.groupViews(created, userId),
      this.groupViews(joined, userId),
      this.groupViews(requestedGroups.filter((group) => group.status === StudyGroupStatus.OPEN), userId),
    ]);
    const openById = new Map(openViews.map((view) => [view.id, view]));
    const groupById = new Map(requestedGroups.map((group) => [group.id, group]));
    return {
      created: { items: createdViews, truncated: createdTotal > MY_LIST_LIMIT },
      memberships: { items: joinedViews, truncated: joinedTotal > MY_LIST_LIMIT },
      requests: {
        items: requests.flatMap((row) => {
          const group = groupById.get(row.groupId);
          if (!group) return [];
          const request = { id: row.id, status: row.status, requestedAt: row.createdAt, reviewedAt: row.reviewedAt };
          const summary = openById.get(group.id) ?? { id: group.id, title: group.title, courseCode: group.courseCode, topic: group.topic, status: group.status };
          return [{ request, group: summary }];
        }),
        truncated: requestsTotal > MY_LIST_LIMIT,
      },
    };
  }
  async join(groupId: string, userId: string) {
    const campus = await this.campusFor(userId);
    return this.dataSource.transaction(async (manager) => {
      const groups = manager.getRepository(StudyGroup), members = manager.getRepository(StudyGroupMember);
      const group = await groups.findOne({ where: { id: groupId, campus }, lock: { mode: 'pessimistic_write' } });
      if (!group || group.status !== StudyGroupStatus.OPEN) throw new NotFoundException('Open study group not found');
      if (group.creatorId === userId) throw new ConflictException('You are already the group creator');
      const existing = await members.findOne({ where: { groupId, userId } });
      if (existing?.status === StudyGroupMemberStatus.ACTIVE) throw new ConflictException('You are already a member');
      if (existing?.status === StudyGroupMemberStatus.PENDING) throw new ConflictException('Your join request is already pending');
      const activeCount = await members.count({ where: { groupId, status: StudyGroupMemberStatus.ACTIVE } });
      const status = group.approvalRequired ? StudyGroupMemberStatus.PENDING : StudyGroupMemberStatus.ACTIVE;
      if (status === StudyGroupMemberStatus.ACTIVE && activeCount >= group.participantLimit) throw new ConflictException('This group has reached its participant limit');
      if (existing) { existing.status = status; existing.campus = campus; existing.reviewedAt = null; return members.save(existing); }
      return members.save(members.create({ groupId, userId, campus, role: StudyGroupMemberRole.MEMBER, status, reviewedAt: null }));
    });
  }
  /** Display fields only: no user ids, no emails. Archived-group outsiders get 404, as on the group page. */
  async listMembers(groupId: string, userId: string) {
    const campus = await this.campusFor(userId), group = await this.getVisibleGroup(groupId, userId, campus);
    const mine = await this.members.findOne({ where: { groupId, userId } });
    if (group.creatorId !== userId && mine?.status !== StudyGroupMemberStatus.ACTIVE) throw new ForbiddenException('Only group members can view the member list');
    const rows = await this.members.find({ where: { groupId, campus, status: StudyGroupMemberStatus.ACTIVE }, order: { createdAt: 'ASC' } });
    const users = rows.length ? await this.users.find({ where: rows.map((row) => ({ id: row.userId })), select: { id: true, name: true } }) : [];
    const names = new Map(users.map((user) => [user.id, user.name]));
    return rows.map((row) => ({ name: names.get(row.userId) ?? 'Student', role: row.role, joinedAt: row.createdAt }));
  }
  async listRequests(groupId: string, userId: string) {
    const campus = await this.campusFor(userId), group = await this.getGroup(groupId, campus);
    if (group.creatorId !== userId) throw new ForbiddenException('Only the group creator can review requests');
    const rows = await this.members.find({ where: { groupId, campus, status: StudyGroupMemberStatus.PENDING }, order: { createdAt: 'ASC' } });
    const users = rows.length ? await this.users.find({ where: rows.map((row) => ({ id: row.userId })), select: { id: true, name: true } }) : [];
    const names = new Map(users.map((user) => [user.id, user.name]));
    return rows.map((row) => ({ id: row.id, userId: row.userId, name: names.get(row.userId) ?? 'Student', requestedAt: row.createdAt }));
  }
  async review(groupId: string, memberId: string, userId: string, status: StudyGroupMemberStatus) {
    const campus = await this.campusFor(userId);
    return this.dataSource.transaction(async (manager) => {
      const groups = manager.getRepository(StudyGroup), members = manager.getRepository(StudyGroupMember);
      const group = await groups.findOne({ where: { id: groupId, campus }, lock: { mode: 'pessimistic_write' } });
      if (!group || group.status !== StudyGroupStatus.OPEN) throw new NotFoundException('Open study group not found');
      if (group.creatorId !== userId) throw new ForbiddenException('Only the group creator can review requests');
      const member = await members.findOne({ where: { id: memberId, groupId, campus } });
      if (!member || member.status !== StudyGroupMemberStatus.PENDING) throw new NotFoundException('Pending membership request not found');
      if (status === StudyGroupMemberStatus.ACTIVE) {
        const count = await members.count({ where: { groupId, status: StudyGroupMemberStatus.ACTIVE } });
        if (count >= group.participantLimit) throw new ConflictException('This group has reached its participant limit');
      }
      member.status = status; member.reviewedAt = new Date();
      return members.save(member);
    });
  }
  async leave(groupId: string, userId: string) {
    const campus = await this.campusFor(userId), group = await this.getGroup(groupId, campus);
    if (group.creatorId === userId) throw new BadRequestException('The creator cannot leave; archive the group instead');
    const member = await this.members.findOne({ where: { groupId, userId, campus } });
    if (!member || member.status === StudyGroupMemberStatus.REJECTED) throw new NotFoundException('Membership not found');
    await this.members.remove(member);
    return { success: true };
  }
  async archive(groupId: string, userId: string) {
    const campus = await this.campusFor(userId), group = await this.getGroup(groupId, campus);
    if (group.creatorId !== userId) throw new ForbiddenException('Only the group creator can archive it');
    group.status = StudyGroupStatus.ARCHIVED;
    return this.groups.save(group);
  }
  
}
