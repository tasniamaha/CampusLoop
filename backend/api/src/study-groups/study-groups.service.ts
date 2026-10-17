import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
  private async groupView(group: StudyGroup, userId: string) {
    const [memberCount, mine] = await Promise.all([
      this.members.count({ where: { groupId: group.id, status: StudyGroupMemberStatus.ACTIVE } }),
      this.members.findOne({ where: { groupId: group.id, userId } }),
    ]);
    return { ...group, memberCount, isCreator: group.creatorId === userId, myMembershipStatus: mine?.status ?? null, myMembershipRole: mine?.role ?? null };
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
    return { data: await Promise.all(rows.map((group) => this.groupView(group, userId))), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
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
  async listMembers(groupId: string, userId: string) {
    const campus = await this.campusFor(userId), group = await this.getGroup(groupId, campus);
    const mine = await this.members.findOne({ where: { groupId, userId } });
    if (group.creatorId !== userId && mine?.status !== StudyGroupMemberStatus.ACTIVE) throw new ForbiddenException('Only group members can view the member list');
    const rows = await this.members.find({ where: { groupId, campus, status: StudyGroupMemberStatus.ACTIVE }, order: { createdAt: 'ASC' } });
    const users = rows.length ? await this.users.find({ where: rows.map((row) => ({ id: row.userId })), select: { id: true, name: true } }) : [];
    const names = new Map(users.map((user) => [user.id, user.name]));
    return rows.map((row) => ({ id: row.id, userId: row.userId, name: names.get(row.userId) ?? 'Student', role: row.role, joinedAt: row.createdAt }));
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
