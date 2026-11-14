import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { checkItemWindow, LostFoundService } from './lost-found.service.js';
import { LostFoundStatus, LostFoundType, type LostFoundReport } from './entities/lost-found-report.entity.js';
import { LostFoundClaimStatus, type LostFoundClaim } from './entities/lost-found-claim.entity.js';

const user = { id: 'user-1', campus: 'North Campus' };
const report = (overrides: Partial<LostFoundReport> = {}): LostFoundReport => ({
  id: 'report-1', reporterId: 'user-2', campus: 'North Campus', type: LostFoundType.FOUND,
  title: 'Black water bottle', description: 'Black metal bottle with silver lid',
  category: 'Bottle', location: 'Library', itemDate: '2026-10-15', itemDateTo: null, color: null, brand: null, imageUrl: null,
  status: LostFoundStatus.OPEN, resolvedAt: null, createdAt: new Date('2026-10-15T10:00:00Z'),
  updatedAt: new Date('2026-10-15T10:00:00Z'), ...overrides,
});

function setup() {
  const reports = {
    findAndCount: vi.fn(), find: vi.fn(), findOne: vi.fn(), create: vi.fn((value: Partial<LostFoundReport>) => value), save: vi.fn(async (value: Partial<LostFoundReport>) => value),
  };
  const users = { findOne: vi.fn().mockResolvedValue(user) };
  const claims = { find: vi.fn(), findOne: vi.fn(), create: vi.fn((value: Partial<LostFoundClaim>) => value), save: vi.fn(async (value: Partial<LostFoundClaim> | Partial<LostFoundClaim>[]) => value) };
  const service = new LostFoundService(
    reports as never,
    users as never,
    claims as never,
    { transaction: vi.fn() } as never,
    { create: vi.fn() } as never,
  );
  return { service, reports, users, claims };
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

  it('stores colour, brand and the time window, and returns them', async () => {
    const { service, reports } = setup();
    reports.save.mockImplementation(async (value: Partial<LostFoundReport>) => ({ ...value, id: 'new-id' }));
    const result = await service.create('user-1', {
      type: LostFoundType.LOST, title: 'Bottle', description: 'Steel bottle', category: 'Bottle',
      location: 'Library', itemDate: '2026-10-13', itemDateTo: '2026-10-15', color: 'blue', brand: 'Milton',
    });
    expect(reports.create).toHaveBeenCalledWith(expect.objectContaining({
      itemDate: '2026-10-13', itemDateTo: '2026-10-15', color: 'blue', brand: 'Milton',
    }));
    expect(result).toMatchObject({ itemDateTo: '2026-10-15', color: 'blue', brand: 'Milton' });
  });

  it('stores missing attributes as null', async () => {
    const { service, reports } = setup();
    await service.create('user-1', {
      type: LostFoundType.FOUND, title: 'Bottle', description: 'Steel bottle', category: 'Bottle',
      location: 'Library', itemDate: '2026-10-13',
    });
    expect(reports.create).toHaveBeenCalledWith(expect.objectContaining({ itemDateTo: null, color: null, brand: null }));
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



  it('submits private ownership evidence for an open found item in the same campus', async () => {
    const { service, reports, claims } = setup();
    reports.findOne.mockResolvedValue(report({ reporterId: 'user-2', type: LostFoundType.FOUND }));
    claims.findOne.mockResolvedValue(null);
    claims.save.mockImplementation(async (value) => Array.isArray(value) ? value : ({ ...value, id: 'claim-1' }));
    const result = await service.submitClaim('report-1', 'user-1', {
      proofDetails: 'It has a small scratch near the bottom and a blue sticker inside.',
    });
    expect(claims.create).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'report-1', claimantId: 'user-1', campus: 'North Campus', status: LostFoundClaimStatus.PENDING,
    }));
    expect(result).toMatchObject({ id: 'claim-1', status: LostFoundClaimStatus.PENDING });
    expect(result).toHaveProperty('proofDetails');
  });

  it('does not allow a report creator to claim their own found item', async () => {
    const { service, reports, claims } = setup();
    reports.findOne.mockResolvedValue(report({ reporterId: 'user-1', type: LostFoundType.FOUND }));
    await expect(service.submitClaim('report-1', 'user-1', {
      proofDetails: 'This is enough detail to prove that the item is mine.',
    })).rejects.toThrow('You cannot claim your own report');
    expect(claims.save).not.toHaveBeenCalled();
  });

  it('allows only the report creator to list claims', async () => {
    const { service, reports } = setup();
    reports.findOne.mockResolvedValue(report({ reporterId: 'different-user' }));
    await expect(service.listClaims('report-1', 'user-1')).rejects.toBeInstanceOf(ForbiddenException);
  });


  it('approves a pending claim only for the report creator and resolves the item', async () => {
    const { service, reports, claims } = setup();
    const pendingClaim: LostFoundClaim = {
      id: 'claim-1', reportId: 'report-1', claimantId: 'user-3', campus: 'North Campus',
      proofDetails: 'Distinctive scratch and blue sticker inside the bottle.',
      status: LostFoundClaimStatus.PENDING, reviewerNote: null, reviewedAt: null,
      createdAt: new Date('2026-10-15T10:00:00Z'), updatedAt: new Date('2026-10-15T10:00:00Z'),
    };
    claims.findOne.mockResolvedValue(pendingClaim);
    claims.find.mockResolvedValue([]);
    claims.save.mockImplementation(async (value) => Array.isArray(value) ? value : value);
    reports.findOne.mockResolvedValue(report({ reporterId: 'user-1', status: LostFoundStatus.OPEN }));
    const result = await service.reviewClaim('claim-1', 'user-1', {
      status: LostFoundClaimStatus.APPROVED,
      reviewerNote: 'Ownership details matched.',
    });
    expect(result).toMatchObject({ status: LostFoundClaimStatus.APPROVED, reviewerNote: 'Ownership details matched.' });
    expect(reports.save).toHaveBeenCalledWith(expect.objectContaining({ status: LostFoundStatus.RESOLVED }));
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

describe('checkItemWindow', () => {
  // 2026-11-14 at 20:00 UTC: already 2026-11-15 in UTC+6.
  const now = new Date('2026-11-14T20:00:00Z');
  const check = (from: string, to?: string) => checkItemWindow(from, to, now);

  it('treats a missing end, or an end equal to the start, as a single day', () => {
    expect(check('2026-11-10')).toEqual({ itemDate: '2026-11-10', itemDateTo: null });
    expect(check('2026-11-10', '2026-11-10')).toEqual({ itemDate: '2026-11-10', itemDateTo: null });
  });

  it('accepts a window of up to 30 days', () => {
    expect(check('2026-10-12', '2026-11-11')).toEqual({ itemDate: '2026-10-12', itemDateTo: '2026-11-11' });
  });

  it('allows dates one day past the UTC date, for users ahead of UTC', () => {
    expect(check('2026-11-15')).toEqual({ itemDate: '2026-11-15', itemDateTo: null });
    expect(check('2026-11-13', '2026-11-15').itemDateTo).toBe('2026-11-15');
  });

  it.each([
    ['2026-11-16', undefined, 'Item date cannot be in the future'],
    ['2026-11-10', '2026-11-16', 'Item end date cannot be in the future'],
    ['2026-11-10', '2026-11-09', 'Item end date cannot be before the item date'],
    ['2026-10-11', '2026-11-11', 'The item date range can span at most 30 days'],
    ['2026-02-30', undefined, 'Item date must be a valid calendar date'],
    ['2026-11-10', '2026-11-31', 'Item end date must be a valid calendar date'],
    ['2026-11-10', '2026-11-11T00:00:00Z', 'Item end date must be a valid calendar date'],
  ])('rejects %s to %s', (from, to, message) => {
    expect(() => check(from, to)).toThrow(message);
  });
});
