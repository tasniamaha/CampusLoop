import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { Resource } from '../src/resources/entities/resource.entity.js';
import { ResourceCategory } from '../src/resources/entities/resource-category.entity.js';
import { ResourceImage } from '../src/resources/entities/resource-image.entity.js';
import { ResourceFavorite } from '../src/resources/entities/resource-favorite.entity.js';
import { BorrowRequest, BorrowStatus } from '../src/borrow-requests/entities/borrow-request.entity.js';
import { LoanEvent } from '../src/borrow-requests/entities/loan-event.entity.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { AddEmailCanonical1792700000000 } from '../src/database/migrations/1792700000000-AddEmailCanonical.js';
import { CreateUsers1791838335819 } from '../src/database/migrations/1791838335819-CreateUsers.js';
import { CreateResourcesAndBorrowRequests1791900000000 } from '../src/database/migrations/1791900000000-CreateResourcesAndBorrowRequests.js';
import { ResourceMarketplace1792000000000 } from '../src/database/migrations/1792000000000-ResourceMarketplace.js';
import { CreateLoanEvents1792100000000 } from '../src/database/migrations/1792100000000-CreateLoanEvents.js';
import { CreateNotifications1792800000000 } from '../src/database/migrations/1792800000000-CreateNotifications.js';
import { CreateReviews1792900000000 } from '../src/database/migrations/1792900000000-CreateReviews.js';
import { ReviewsBothSides1793000000000 } from '../src/database/migrations/1793000000000-ReviewsBothSides.js';
import { ReviewBlindAndModeration1793100000000 } from '../src/database/migrations/1793100000000-ReviewBlindAndModeration.js';
import { CreateReports1793200000000 } from '../src/database/migrations/1793200000000-CreateReports.js';

// Proves the two review migrations on a database that ALREADY holds reviews written by the
// original schema (one review per loan, no reviewee). Uses the existing campusloop_test database:
// it steps the two migrations back, seeds legacy-shaped reviews, then migrates forward and back
// again. It always finishes by restoring the fully migrated schema and removing its own rows.
// It deletes every row in `reviews` first (test data only; guard-test-db.ts enforces a *_test DB),
// so it relies on fileParallelism: false in vitest.config.e2e.ts, which is already set.
const SCHEMA = process.env.TEST_DB_NAME ?? 'campusloop_test';
const conn = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3317),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'root',
};
const BASE_MIGRATIONS = [
  AddEmailCanonical1792700000000,
  CreateUsers1791838335819,
  CreateResourcesAndBorrowRequests1791900000000,
  ResourceMarketplace1792000000000,
  CreateLoanEvents1792100000000,
  CreateNotifications1792800000000,
];
const ENTITIES = [User, Resource, ResourceCategory, ResourceImage, ResourceFavorite, BorrowRequest, LoanEvent, Notification];
const NEW_COLUMNS = ['reviewerRole', 'revieweeId', 'isHidden', 'hiddenAt', 'hiddenById', 'hiddenReason', 'revealedAt', 'windowClosesAt'];

let ds: DataSource;
const rand = () => Math.random().toString(36).slice(2, 10);

const columns = async () =>
  (
    (await ds.query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'reviews'`,
      [SCHEMA],
    )) as Array<{ c: string }>
  ).map((r) => r.c);

const indexes = async () =>
  (
    (await ds.query(
      `SELECT DISTINCT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'reviews'`,
      [SCHEMA],
    )) as Array<{ i: string }>
  ).map((r) => r.i);

let ownerId = '';
const created = '2026-09-01 10:00:00.000000';

beforeAll(async () => {
  ds = new DataSource({
    type: 'mysql',
    timezone: 'Z',
    ...conn,
    database: SCHEMA,
    entities: ENTITIES,
    migrations: [
      ...BASE_MIGRATIONS,
      CreateReviews1792900000000,
      ReviewsBothSides1793000000000,
      ReviewBlindAndModeration1793100000000,
      CreateReports1793200000000,
    ] as never,
    synchronize: false,
    dropSchema: false,
  });
  await ds.initialize();

  // 1) Make sure we start fully migrated, clear leftover review rows, then step back to the legacy shape.
  await ds.runMigrations();
  await ds.query('DELETE FROM reviews');
  await ds.undoLastMigration(); // CreateReports
  await ds.undoLastMigration(); // ReviewBlindAndModeration
  await ds.undoLastMigration(); // ReviewsBothSides
  expect(await columns()).not.toContain('revieweeId');

  // 2) Seed one owner, three borrowers and three RETURNED loans.
  const users = ds.getRepository(User);
  const mk = (label: string) =>
    users.save(
      users.create({
        name: label,
        email: `${label}-${rand()}@mig.local`,
        passwordHash: 'x',
        campus: 'test',
        role: UserRole.STUDENT,
        emailVerifiedAt: null,
      }),
    );
  const owner = await mk('owner');
  ownerId = owner.id;
  const borrowers = [await mk('b1'), await mk('b2'), await mk('b3')];

  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const resource = await ds.getRepository(Resource).save(
    ds.getRepository(Resource).create({
      ownerId: owner.id,
      categoryId: category.id,
      title: 'Legacy calc',
      description: null,
      isListed: true,
    }),
  );

  // 3) Three legacy reviews in the OLD shape: borrower -> owner, ratings 5/3/1, one with a comment.
  const ratings = [5, 3, 1];
  for (const [i, borrower] of borrowers.entries()) {
    const loan = await ds.getRepository(BorrowRequest).save(
      ds.getRepository(BorrowRequest).create({
        resourceId: resource.id,
        borrowerId: borrower.id,
        dueDate: new Date(Date.now() + 86_400_000),
        message: null,
        status: BorrowStatus.RETURNED,
      }),
    );
    await ds.query(
      `INSERT INTO reviews (id, borrowRequestId, resourceId, reviewerId, rating, comment, createdAt, updatedAt)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
      [loan.id, resource.id, borrower.id, ratings[i], i === 0 ? 'legacy comment' : null, created, created],
    );
  }
}, 120_000);

afterAll(async () => {
  if (!ds?.isInitialized) return;
  try {
    await ds.runMigrations(); // always leave campusloop_test fully migrated, even after a failure
    await ds.query(
      `DELETE br FROM borrow_requests br JOIN resources r ON r.id = br.resourceId
         JOIN users u ON u.id = r.ownerId WHERE u.email LIKE '%@mig.local'`,
    ); // reviews cascade from borrow_requests
    await ds.query(`DELETE FROM resources WHERE ownerId IN (SELECT id FROM users WHERE email LIKE '%@mig.local')`);
    await ds.query(`DELETE FROM reports WHERE reporterId IN (SELECT id FROM users WHERE email LIKE '%@mig.local')`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@mig.local'`);
  } finally {
    await ds.destroy();
  }
});

async function expectMigratedDataIntact() {
  const rows = await ds.query(
    'SELECT rating, comment, reviewerRole, revieweeId, isHidden FROM reviews ORDER BY rating DESC',
  );
  expect(rows.map((r: { rating: number }) => Number(r.rating))).toEqual([5, 3, 1]);
  expect(rows[0].comment).toBe('legacy comment');
  for (const r of rows) {
    expect(r.reviewerRole).toBe('borrower'); // every legacy row was borrower -> owner
    expect(r.revieweeId).toBe(ownerId); // backfilled from resources.ownerId
    expect(Number(r.isHidden)).toBe(0);
  }
  // Legacy reviews were public when written: they must stay visible under the blind-review rule.
  const [visible] = await ds.query(
    `SELECT COUNT(*) AS n FROM reviews
      WHERE revealedAt = createdAt AND windowClosesAt = createdAt AND windowClosesAt <= UTC_TIMESTAMP(6)`,
  );
  expect(Number(visible.n)).toBe(3);
}

describe('review migrations on a database that already holds reviews', () => {
  it('up: backfills reviewee, reveal state and window; keeps every row; adds constraints', async () => {
    const pending = await ds.showMigrations();
    expect(pending).toBe(true);
    await ds.runMigrations();

    await expectMigratedDataIntact();

    const cols = await columns();
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);
    const [nullable] = await ds.query(
      `SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'windowClosesAt'`,
      [SCHEMA],
    );
    expect(nullable.n).toBe('NO');

    const idx = await indexes();
    expect(idx).toContain('UQ_reviews_loan_reviewer');
    expect(idx).toContain('IDX_reviews_reviewee_hidden');
    expect(idx).not.toContain('UQ_reviews_borrowRequestId'); // replaced by the per-reviewer key
  });

  it('keeps enforcing the rules after the migration (rating CHECK, one review per loan and reviewer)', async () => {
    const [row] = await ds.query('SELECT borrowRequestId, resourceId, reviewerId, revieweeId FROM reviews LIMIT 1');
    await expect(
      ds.query(
        `INSERT INTO reviews (id, borrowRequestId, resourceId, reviewerId, reviewerRole, revieweeId, rating, windowClosesAt)
         VALUES (UUID(), ?, ?, ?, 'borrower', ?, 4, UTC_TIMESTAMP(6))`,
        [row.borrowRequestId, row.resourceId, row.reviewerId, row.revieweeId],
      ),
    ).rejects.toThrow(/Duplicate entry/i);
    await expect(
      ds.query(
        `INSERT INTO reviews (id, borrowRequestId, resourceId, reviewerId, reviewerRole, revieweeId, rating, windowClosesAt)
         VALUES (UUID(), ?, ?, ?, 'owner', ?, 9, UTC_TIMESTAMP(6))`,
        [row.borrowRequestId, row.resourceId, row.revieweeId, row.reviewerId],
      ),
    ).rejects.toThrow(/CHK_reviews_rating|check constraint/i);
  });

  it('down (review and reports migrations): removes new columns and returns to the legacy review shape without losing rows', async () => {
    await ds.undoLastMigration(); // CreateReports
    await ds.undoLastMigration(); // ReviewBlindAndModeration
    await ds.undoLastMigration(); // ReviewsBothSides

    const cols = await columns();
    for (const c of NEW_COLUMNS) expect(cols).not.toContain(c);
    const idx = await indexes();
    expect(idx).toContain('UQ_reviews_borrowRequestId');
    expect(idx).not.toContain('UQ_reviews_loan_reviewer');

    const rows = await ds.query('SELECT rating, comment FROM reviews ORDER BY rating DESC');
    expect(rows.map((r: { rating: number }) => Number(r.rating))).toEqual([5, 3, 1]);
    expect(rows[0].comment).toBe('legacy comment');
  });

  it('up again after a revert: the backfill works a second time', async () => {
    await ds.runMigrations();
    await expectMigratedDataIntact();
  });
});