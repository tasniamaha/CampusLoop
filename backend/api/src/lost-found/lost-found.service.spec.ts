import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LostFoundService } from './lost-found.service.js';
import { LostFoundStatus, LostFoundType, type LostFoundReport } from './entities/lost-found-report.entity.js';

const user = { id: 'user-1', campus: 'North Campus' };
const report = (overrides: Partial<LostFoundReport> = {}): LostFoundReport => ({
  id: 'report-1', reporterId: 'user-2', campus: 'North Campus', type: LostFoundType.FOUND,
  title: 'Black water bottle', description: 'Black metal bottle with silver lid',
  category: 'Bottle', location: 'Library', itemDate: '2026-10-15', imageUrl: null,
  status: LostFoundStatus.OPEN, resolvedAt: null, createdAt: new Date('2026-10-15T10:00:00Z'),
  updatedAt: new Date('2026-10-15T10:00:00Z'), ...overrides,
});

function setup() {
  const reports = {
    findAndCount: vi.fn(), find: vi.fn(), findOne: vi.fn(), create: vi.fn((value: Partial<LostFoundReport>) => value), save: vi.fn(async (value: Partial<LostFoundReport>) => value),
  };
  const users = { findOne: vi.fn().mockResolvedValue(user) };
  const service = new LostFoundService(reports as never, users as never);
  return { service, reports, users };
}

describe('LostFoundService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists only open reports in the signed-in user campus and hides reporter ids', async () => {
    const { service, reports } = setup();
    reports.findAndCount.mockResolvedValue([[report()], 1]);
    const result = await service.list('user-1', { page: 1, limit: 20 });
    expect(reports.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: { campus: 'North Campus', status: LostFoundStatus.OPEN }, skip: 0, take: 20,
    }));
    expect(result.pagination.total).toBe(1);
    expect(result.data[0]).not.toHaveProperty('reporterId');
    expect(result.data[0]).toMatchObject({ isMine: false, title: 'Black water bottle' });
  });

  it('creates a normalized report tied to the authenticated user and their campus', async () => {
    const { service, reports } = setup();
    reports.save.mockImplementation(async (value: Partial<LostFoundReport>) => ({ ...value, id: 'new-id' }));
    const result = await service.create('user-1', {
      type: LostFoundType.LOST, title: '  Laptop  ', description: ' silver laptop ', category: ' Electronics ',
      location: ' Main hall ', itemDate: '2026-10-15',
    });
    expect(reports.create).toHaveBeenCalledWith(expect.objectContaining({
      reporterId: 'user-1', campus: 'North Campus', title: 'Laptop', description: 'silver laptop',
      category: 'Electronics', location: 'Main hall', status: LostFoundStatus.OPEN,
    }));
    expect(result).not.toHaveProperty('reporterId');
  });

  it('rejects future dates', async () => {
    const { service } = setup();
    await expect(service.create('user-1', {
      type: LostFoundType.LOST, title: 'Laptop', description: 'Silver laptop', category: 'Electronics',
      location: 'Main hall', itemDate: '2999-01-01',
    })).rejects.toThrow('Item date cannot be in the future');
  });

  it('does not allow another user to resolve a report', async () => {
    const { service, reports } = setup();
    reports.findOne.mockResolvedValue(report({ reporterId: 'someone-else' }));
    await expect(service.resolve('report-1', 'user-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(reports.save).not.toHaveBeenCalled();
  });

  it('returns not found for a report outside the user campus', async () => {
    const { service, reports } = setup();
    reports.findOne.mockResolvedValue(null);
    await expect(service.resolve('report-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('suggests opposite-type reports with a positive score and no reporter identifiers', async () => {
    const { service, reports } = setup();
    reports.findOne.mockResolvedValue(report({ id: 'lost-1', type: LostFoundType.LOST, reporterId: 'user-1', title: 'Black water bottle' }));
    reports.find.mockResolvedValue([report({ id: 'found-1', type: LostFoundType.FOUND, reporterId: 'user-2', title: 'Black water bottle' })]);
    const matches = await service.matches('lost-1', 'user-1');
    expect(matches[0]).toMatchObject({ report: { id: 'found-1' }, score: 100 });
    expect(matches[0].report).not.toHaveProperty('reporterId');
  });
});
