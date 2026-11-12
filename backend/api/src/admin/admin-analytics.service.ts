import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BorrowStatus } from '../borrow-requests/entities/borrow-request.entity.js';
import { LostFoundClaimStatus } from '../lost-found/entities/lost-found-claim.entity.js';

type LoanCounts = Record<BorrowStatus, number>;
type ClaimCounts = Record<LostFoundClaimStatus, number>;
type OpenResolved = { open: number; resolved: number };

export interface CampusCounts {
  users: { total: number; active: number; deactivated: number };
  /** Listings that are not deleted, by the owner's campus. */
  resources: number;
  /** Loans in status `active` (picked up, not yet returned). */
  activeLoans: number;
  /** Every loan by status, by the resource owner's campus. */
  loans: LoanCounts;
  lostFound: { lost: OpenResolved; found: OpenResolved };
  claims: ClaimCounts;
  studyGroups: { open: number; archived: number };
}

export interface AnalyticsView {
  generatedAt: Date;
  campuses: Array<{ campus: string } & CampusCounts>;
  totals: CampusCounts;
}

const LOAN_STATUSES = Object.values(BorrowStatus);
const CLAIM_STATUSES = Object.values(LostFoundClaimStatus);

const empty = (): CampusCounts => ({
  users: { total: 0, active: 0, deactivated: 0 },
  resources: 0,
  activeLoans: 0,
  loans: Object.fromEntries(LOAN_STATUSES.map((s) => [s, 0])) as LoanCounts,
  lostFound: { lost: { open: 0, resolved: 0 }, found: { open: 0, resolved: 0 } },
  claims: Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0])) as ClaimCounts,
  studyGroups: { open: 0, archived: 0 },
});

type Row = Record<string, string | number | null>;
const n = (value: string | number | null | undefined) => Number(value ?? 0);

/**
 * Per-campus dashboard counts. A fixed six aggregate queries (one per table, GROUP BY campus) run
 * in parallel and are merged in memory, so the cost does not grow with the number of campuses or
 * rows returned. Campus names are grouped exactly as stored (see project.md §12, Known limitations).
 * Resources and loans have no campus column: they count under the owner's current campus.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly dataSource: DataSource) {}

  async get(): Promise<AnalyticsView> {
    const q = (sql: string) => this.dataSource.query(sql) as Promise<Row[]>;
    const [users, resources, loans, reports, claims, groups] = await Promise.all([
      q(`SELECT campus, COUNT(*) AS total, SUM(deactivatedAt IS NULL) AS active FROM users GROUP BY campus`),
      q(`SELECT u.campus, COUNT(*) AS total
           FROM resources r JOIN users u ON u.id = r.ownerId
          WHERE r.deletedAt IS NULL
          GROUP BY u.campus`),
      q(`SELECT u.campus, br.status, COUNT(*) AS total
           FROM borrow_requests br
           JOIN resources r ON r.id = br.resourceId
           JOIN users u ON u.id = r.ownerId
          GROUP BY u.campus, br.status`),
      q(`SELECT campus, type, status, COUNT(*) AS total FROM lost_found_reports GROUP BY campus, type, status`),
      q(`SELECT campus, status, COUNT(*) AS total FROM lost_found_claims GROUP BY campus, status`),
      q(`SELECT campus, status, COUNT(*) AS total FROM study_groups GROUP BY campus, status`),
    ]);

    const byCampus = new Map<string, CampusCounts>();
    const at = (campus: string | number | null) => {
      const key = String(campus ?? '');
      let counts = byCampus.get(key);
      if (!counts) byCampus.set(key, (counts = empty()));
      return counts;
    };

    for (const row of users) {
      const c = at(row.campus);
      c.users.total = n(row.total);
      c.users.active = n(row.active);
      c.users.deactivated = c.users.total - c.users.active;
    }
    for (const row of resources) at(row.campus).resources = n(row.total);
    for (const row of loans) {
      const c = at(row.campus);
      const status = row.status as BorrowStatus;
      if (status in c.loans) c.loans[status] = n(row.total);
    }
    for (const row of reports) {
      const side = at(row.campus).lostFound[row.type === 'found' ? 'found' : 'lost'];
      side[row.status === 'resolved' ? 'resolved' : 'open'] += n(row.total);
    }
    for (const row of claims) {
      const c = at(row.campus);
      const status = row.status as LostFoundClaimStatus;
      if (status in c.claims) c.claims[status] = n(row.total);
    }
    for (const row of groups) at(row.campus).studyGroups[row.status === 'archived' ? 'archived' : 'open'] = n(row.total);

    const totals = empty();
    const campuses = [...byCampus.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([campus, c]) => {
        c.activeLoans = c.loans[BorrowStatus.ACTIVE];
        add(totals, c);
        return { campus, ...c };
      });
    return { generatedAt: new Date(), campuses, totals };
  }
}

function add(into: CampusCounts, c: CampusCounts) {
  into.users.total += c.users.total;
  into.users.active += c.users.active;
  into.users.deactivated += c.users.deactivated;
  into.resources += c.resources;
  into.activeLoans += c.activeLoans;
  for (const s of LOAN_STATUSES) into.loans[s] += c.loans[s];
  for (const side of ['lost', 'found'] as const) {
    into.lostFound[side].open += c.lostFound[side].open;
    into.lostFound[side].resolved += c.lostFound[side].resolved;
  }
  for (const s of CLAIM_STATUSES) into.claims[s] += c.claims[s];
  into.studyGroups.open += c.studyGroups.open;
  into.studyGroups.archived += c.studyGroups.archived;
}
