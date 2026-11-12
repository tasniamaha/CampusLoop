import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AdminAnalyticsService } from './admin-analytics.service.js';
import { AdminAuditService } from './admin-audit.service.js';

describe('AdminAnalyticsService', () => {
  it('runs a fixed six aggregate queries and merges them per campus, with totals', async () => {
    const answers: Record<string, unknown[]> = {
      'FROM users GROUP BY': [
        { campus: 'North', total: '3', active: '2' },
        { campus: 'South', total: 1, active: 1 },
      ],
      'FROM resources r': [{ campus: 'North', total: '4' }],
      'FROM borrow_requests br': [
        { campus: 'North', status: 'active', total: '2' },
        { campus: 'North', status: 'returned', total: '5' },
        { campus: 'South', status: 'pending', total: '1' },
      ],
      'FROM lost_found_reports': [
        { campus: 'North', type: 'lost', status: 'open', total: '1' },
        { campus: 'North', type: 'found', status: 'resolved', total: '2' },
      ],
      'FROM lost_found_claims': [{ campus: 'South', status: 'approved', total: '1' }],
      'FROM study_groups': [{ campus: 'North', status: 'archived', total: '1' }],
    };
    const query = vi.fn(async (sql: string) => Object.entries(answers).find(([key]) => sql.includes(key))?.[1] ?? []);
    const result = await new AdminAnalyticsService({ query } as unknown as DataSource).get();

    expect(query).toHaveBeenCalledTimes(6);
    expect(result.campuses.map((c) => c.campus)).toEqual(['North', 'South']);
    const north = result.campuses[0];
    expect(north.users).toEqual({ total: 3, active: 2, deactivated: 1 });
    expect(north.resources).toBe(4);
    expect(north.activeLoans).toBe(2);
    expect(north.loans).toMatchObject({ active: 2, returned: 5, pending: 0, expired: 0 });
    expect(north.lostFound).toEqual({ lost: { open: 1, resolved: 0 }, found: { open: 0, resolved: 2 } });
    expect(north.studyGroups).toEqual({ open: 0, archived: 1 });
    expect(result.campuses[1].claims).toEqual({ pending: 0, approved: 1, rejected: 0 });

    expect(result.totals.users).toEqual({ total: 4, active: 3, deactivated: 1 });
    expect(result.totals.loans).toMatchObject({ active: 2, returned: 5, pending: 1 });
    expect(result.totals.activeLoans).toBe(2);
  });
});

describe('AdminAuditService date bounds', () => {
  const service = () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => (sql.startsWith('SELECT COUNT') ? [{ total: 0 }] : []));
    return { query, audit: new AdminAuditService({ query } as unknown as DataSource) };
  };

  it('treats a date-only "to" as the whole day, and accepts from = to on the same day', async () => {
    const { query, audit } = service();
    await audit.list({ from: '2026-11-01', to: '2026-11-01', page: 1, limit: 50 });
    const params = query.mock.calls[0][1] ?? [];
    expect(params.slice(0, 2)).toEqual([new Date('2026-11-01T00:00:00.000Z'), new Date('2026-11-02T00:00:00.000Z')]);
    expect(query.mock.calls[0][0]).toContain('a.createdAt < ?');
  });

  it('rejects "from" after "to" with 400', async () => {
    await expect(service().audit.list({ from: '2026-11-02', to: '2026-11-01', page: 1, limit: 50 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service().audit.list({ from: '2026-11-01T10:00:00Z', to: '2026-11-01T09:00:00Z', page: 1, limit: 50 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
