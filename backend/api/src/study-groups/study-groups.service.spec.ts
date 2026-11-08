import { describe, expect, it, vi } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { StudyGroup } from './entities/study-group.entity.js';
import { StudyGroupMember } from './entities/study-group-member.entity.js';
import { StudyGroupsService } from './study-groups.service.js';

describe('StudyGroupsService', () => {
  it('scopes group discovery to the authenticated user campus and applies course/topic filters', async () => {
    const userRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'user-1', campus: 'North Campus' }),
    };
    const qb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    };
    const groupRepo = { createQueryBuilder: vi.fn().mockReturnValue(qb) };
    const memberRepo = { count: vi.fn(), findOne: vi.fn() };
    const service = new StudyGroupsService(
      groupRepo as unknown as Repository<StudyGroup>,
      memberRepo as unknown as Repository<StudyGroupMember>,
      userRepo as unknown as Repository<User>,
      {} as DataSource,
    );

    const result = await service.list('user-1', {
      page: 1,
      limit: 20,
      courseCode: 'CSE220',
      topic: 'graphs',
    });

    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true, campus: true },
    });
    expect(qb.where).toHaveBeenCalledWith('g.campus = :campus', { campus: 'North Campus' });
    expect(qb.andWhere).toHaveBeenCalledWith('g.status = :status', { status: 'open' });
    expect(qb.andWhere).toHaveBeenCalledWith('LOWER(g.courseCode) LIKE LOWER(:courseCode)', { courseCode: '%CSE220%' });
    expect(qb.andWhere).toHaveBeenCalledWith('LOWER(g.topic) LIKE LOWER(:topic)', { topic: '%graphs%' });
    expect(result.pagination.total).toBe(0);
    expect(result.data).toEqual([]);
  });
  it('builds list views with one grouped count and one membership lookup, not per group', async () => {
    const userRepo = { findOne: vi.fn().mockResolvedValue({ id: 'user-1', campus: 'North Campus' }) };
    const rows = [
      { id: 'g1', creatorId: 'user-1', title: 'A' },
      { id: 'g2', creatorId: 'user-2', title: 'B' },
      { id: 'g3', creatorId: 'user-3', title: 'C' },
    ];
    const listQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([rows, 3]),
    };
    const countQb = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([
        { groupId: 'g1', count: '3' },
        { groupId: 'g2', count: 1 },
      ]),
    };
    const groupRepo = { createQueryBuilder: vi.fn().mockReturnValue(listQb) };
    const memberRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(countQb),
      find: vi.fn().mockResolvedValue([
        { groupId: 'g1', status: 'active', role: 'owner' },
        { groupId: 'g2', status: 'pending', role: 'member' },
      ]),
      count: vi.fn(),
      findOne: vi.fn(),
    };
    const service = new StudyGroupsService(
      groupRepo as unknown as Repository<StudyGroup>,
      memberRepo as unknown as Repository<StudyGroupMember>,
      userRepo as unknown as Repository<User>,
      {} as DataSource,
    );

    const result = await service.list('user-1', { page: 1, limit: 20 });

    expect(memberRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(countQb.where).toHaveBeenCalledWith('m.groupId IN (:...ids)', { ids: ['g1', 'g2', 'g3'] });
    expect(memberRepo.find).toHaveBeenCalledTimes(1);
    expect(memberRepo.count).not.toHaveBeenCalled();
    expect(memberRepo.findOne).not.toHaveBeenCalled();
    expect(result.data.map((g) => [g.id, g.memberCount, g.isCreator, g.myMembershipStatus])).toEqual([
      ['g1', 3, true, 'active'],
      ['g2', 1, false, 'pending'],
      ['g3', 0, false, null],
    ]);
  });
});
