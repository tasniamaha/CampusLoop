// The evaluation measures a frozen copy of LostFoundService.matches() (systems.ts). This spec runs
// the live service on synthetic queries and checks that the copy ranks and scores them the same,
// so the "current matches()" numbers in docs/matching-eval.md describe the real algorithm.

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { LostFoundService } from '../../src/lost-found/lost-found.service.js';
import { LostFoundStatus, LostFoundType, type LostFoundReport } from '../../src/lost-found/entities/lost-found-report.entity.js';
import { UserRole } from '../../src/users/entities/user.entity.js';
import { CURRENT_TAKE, currentMatches, currentScorer } from './systems.js';
import { rankAll, type EvalDataset, type EvalReport } from './types.js';

const dataset = JSON.parse(
  readFileSync(fileURLToPath(new URL('./data/synthetic.json', import.meta.url)), 'utf8'),
) as EvalDataset;

const CAMPUS = 'North Campus';

function entity(report: EvalReport, type: LostFoundType, reporterId: string): LostFoundReport {
  return {
    id: report.id, reporterId, campus: CAMPUS, type, title: report.title, description: report.description,
    category: report.category, location: report.location, itemDate: report.itemDate, imageUrl: null,
    status: LostFoundStatus.OPEN, resolvedAt: null, createdAt: new Date(report.createdAt), updatedAt: new Date(report.createdAt),
  };
}

function service(query: EvalReport, candidates: LostFoundReport[]) {
  const reports = { findOne: vi.fn().mockResolvedValue(entity(query, LostFoundType.LOST, 'viewer')), find: vi.fn().mockResolvedValue(candidates) };
  const users = { findOne: vi.fn().mockResolvedValue({ id: 'viewer', campus: CAMPUS, role: UserRole.STUDENT }) };
  const photos = { find: vi.fn().mockResolvedValue([]) };
  const svc = new LostFoundService(reports as never, users as never, {} as never, {} as never, {} as never, photos as never, {} as never);
  return { svc, reports };
}

describe('frozen copy of the current matches() algorithm', () => {
  it.each(dataset.queries.slice(0, 20).map((q) => [q.id, q] as const))('agrees with LostFoundService.matches() on %s', async (_id, query) => {
    // What the database returns for ORDER BY createdAt DESC LIMIT 100.
    const newest = [...dataset.pool]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, CURRENT_TAKE)
      .map((r) => entity(r, LostFoundType.FOUND, `finder-${r.id}`));
    const { svc, reports } = service(query.report, newest);

    const live = await svc.matches(query.report.id, 'viewer');
    expect(live.length).toBeGreaterThan(0);

    expect(reports.find).toHaveBeenCalledWith(expect.objectContaining({ order: { createdAt: 'DESC' }, take: CURRENT_TAKE }));
    expect(live.map((m) => m.report.id)).toEqual(rankAll(currentMatches, query.report, dataset.pool));
    const byId = new Map(dataset.pool.map((r) => [r.id, r]));
    for (const match of live) {
      expect({ score: match.score, reasons: match.reasons }).toEqual(currentScorer(query.report)(byId.get(match.report.id)!));
    }
  });
});
