import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { Resource } from '../src/resources/entities/resource.entity.js';
import { BorrowRequest, BorrowStatus } from '../src/borrow-requests/entities/borrow-request.entity.js';
import { ResourceCategory } from '../src/resources/entities/resource-category.entity.js';
import { ResourceImage } from '../src/resources/entities/resource-image.entity.js';
import { ResourceFavorite } from '../src/resources/entities/resource-favorite.entity.js';
import { LoanEvent, LoanEventType } from '../src/borrow-requests/entities/loan-event.entity.js';
import type { AuditEntry } from '../src/audit/audit.service.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { Review } from '../src/reviews/entities/review.entity.js';
import { REVIEW_WINDOW_DAYS, ReviewsService } from '../src/reviews/reviews.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { Report } from '../src/reports/entities/report.entity.js';
import { CreateUsers1791838335819 } from '../src/database/migrations/1791838335819-CreateUsers.js';
import { CreateResourcesAndBorrowRequests1791900000000 } from '../src/database/migrations/1791900000000-CreateResourcesAndBorrowRequests.js';
import { ResourceMarketplace1792000000000 } from '../src/database/migrations/1792000000000-ResourceMarketplace.js';
import { CreateLoanEvents1792100000000 } from '../src/database/migrations/1792100000000-CreateLoanEvents.js';
import { AddEmailCanonical1792700000000 } from '../src/database/migrations/1792700000000-AddEmailCanonical.js';
import { CreateNotifications1792800000000 } from '../src/database/migrations/1792800000000-CreateNotifications.js';
import { CreateReviews1792900000000 } from '../src/database/migrations/1792900000000-CreateReviews.js';
import { ReviewsBothSides1793000000000 } from '../src/database/migrations/1793000000000-ReviewsBothSides.js';
import { ReviewBlindAndModeration1793100000000 } from '../src/database/migrations/1793100000000-ReviewBlindAndModeration.js';
import { CreateReports1793200000000 } from '../src/database/migrations/1793200000000-CreateReports.js';

let ds: DataSource;
let service: ReviewsService;
const auditCalls: AuditEntry[] = [];

const rnd = () => Math.random().toString(36).slice(2);

async function seedUser(label: string) {
  const repo = ds.getRepository(User);
  return repo.save(repo.create({
    name: label, email: `${label}-${rnd()}@test.local`, passwordHash: 'x',
    campus: 'test', role: UserRole.STUDENT, emailVerifiedAt: null,
  }));
}

async function addLoan(
  owner: { id: string },
  borrower: { id: string },
  resource: { id: string },
  status: BorrowStatus,
) {
  const loan = await ds.getRepository(BorrowRequest).save(
    ds.getRepository(BorrowRequest).create({
      resourceId: resource.id,
      borrowerId: borrower.id,
      dueDate: new Date(Date.now() + 7 * 86_400_000),
      message: null,
      status,
    }),
  );
  const eventRepository = ds.getRepository(LoanEvent);
  await eventRepository.save(
    eventRepository.create({
      borrowRequestId: loan.id,
      resourceId: resource.id,
      actorId: owner.id,
      eventType: LoanEventType.HANDED_OVER,
      fromStatus: BorrowStatus.APPROVED,
      toStatus: BorrowStatus.ACTIVE,
      note: null,
    }),
  );
  if (status === BorrowStatus.RETURNED) {
    await eventRepository.save(
      eventRepository.create({
        borrowRequestId: loan.id,
        resourceId: resource.id,
        actorId: owner.id,
        eventType: LoanEventType.RETURNED,
        fromStatus: BorrowStatus.ACTIVE,
        toStatus: BorrowStatus.RETURNED,
        note: null,
      }),
    );
  }
  return loan;
}

async function seedLoan(status: BorrowStatus) {
  const owner = await seedUser('owner');
  const borrower = await seedUser('borrower');
  const stranger = await seedUser('stranger');
  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const resource = await ds.getRepository(Resource).save(ds.getRepository(Resource).create({
    ownerId: owner.id, categoryId: category.id, title: 'Calc', description: null, isListed: true,
  }));
  const loan = await addLoan(owner, borrower, resource, status);
  return { owner, borrower, stranger, resource, loan };
}

async function closeWindow(resourceId: string) {
  await ds.query(
    'UPDATE reviews SET windowClosesAt = ? WHERE resourceId = ?',
    [new Date(Date.now() - 1000), resourceId],
  );
}

beforeAll(async () => {
  ds = new DataSource({
    type: 'mysql',
    timezone: 'Z',
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT ?? 3317),
    username: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? 'root',
    database: process.env.TEST_DB_NAME ?? 'campusloop_test',
    entities: [User, Resource, BorrowRequest, ResourceCategory, ResourceImage, ResourceFavorite, LoanEvent, Notification, Review, Report],
    migrations: [
      AddEmailCanonical1792700000000, CreateUsers1791838335819,
      CreateResourcesAndBorrowRequests1791900000000, ResourceMarketplace1792000000000,
      CreateLoanEvents1792100000000, CreateNotifications1792800000000,
      CreateReviews1792900000000, ReviewsBothSides1793000000000,
      ReviewBlindAndModeration1793100000000, CreateReports1793200000000,
    ],
    synchronize: false, dropSchema: false, extra: { connectionLimit: 30 },
  });
  await ds.initialize();
  await ds.runMigrations();
  const auditStub = {
    record: async (_manager: unknown, entry: AuditEntry) => {
      auditCalls.push(entry);
    },
  } as never;
  service = new ReviewsService(ds, auditStub, new ReportsService(ds, auditStub));
}, 60_000);

afterAll(async () => {
  if (!ds?.isInitialized) return;
  try {
    await ds.query(`DELETE le FROM loan_events le
      JOIN resources r ON r.id = le.resourceId
      JOIN users u ON u.id = r.ownerId
      WHERE u.email LIKE '%@test.local'`);
    await ds.query(`DELETE br FROM borrow_requests br JOIN resources r ON r.id = br.resourceId JOIN users u ON u.id = r.ownerId WHERE u.email LIKE '%@test.local'`);
    await ds.query(`DELETE FROM resources WHERE ownerId IN (SELECT id FROM users WHERE email LIKE '%@test.local')`);
    await ds.query(`DELETE FROM reports WHERE reporterId IN (SELECT id FROM users WHERE email LIKE '%@test.local')`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@test.local'`);
  } finally { await ds.destroy(); }
});

describe('item 1: both sides can review', () => {
  it('borrower and owner can each review once, with correct reviewee', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    const a = await service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 5 });
    const b = await service.create(s.owner.id, { borrowRequestId: s.loan.id, rating: 3 });
    expect(a.reviewerRole).toBe('borrower'); expect(a.revieweeId).toBe(s.owner.id);
    expect(b.reviewerRole).toBe('owner');    expect(b.revieweeId).toBe(s.borrower.id);
  });

  it('a second review by the same side gets 409', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await service.create(s.owner.id, { borrowRequestId: s.loan.id, rating: 4 });
    await expect(service.create(s.owner.id, { borrowRequestId: s.loan.id, rating: 2 }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('a stranger gets 403', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await expect(service.create(s.stranger.id, { borrowRequestId: s.loan.id, rating: 5 }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getEligibility(s.loan.id, s.stranger.id))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a loan that is not returned gets 400 for both sides', async () => {
    const s = await seedLoan(BorrowStatus.ACTIVE);
    for (const id of [s.borrower.id, s.owner.id]) {
      await expect(service.create(id, { borrowRequestId: s.loan.id, rating: 5 }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('10 simultaneous submissions by one user create exactly one review', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 4 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
      expect(r.reason).toBeInstanceOf(ConflictException);
    }
    expect(await ds.getRepository(Review).count({ where: { borrowRequestId: s.loan.id } })).toBe(1);
  });

  it('the database itself rejects ratings outside 1-5', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await expect(ds.query(
      `INSERT INTO reviews (id, borrowRequestId, resourceId, reviewerId, reviewerRole, revieweeId, rating, windowClosesAt)
       VALUES (UUID(), ?, ?, ?, 'borrower', ?, 9, UTC_TIMESTAMP(6))`,
      [s.loan.id, s.resource.id, s.borrower.id, s.owner.id],
    )).rejects.toThrow(/CHK_reviews_rating|check constraint/i);
  });

  it('owner->borrower reviews do not count toward the resource rating', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 4 });
    await service.create(s.owner.id, { borrowRequestId: s.loan.id, rating: 1 });
    const res = await service.listForResource(s.resource.id);
    expect(res.reviewCount).toBe(1);
    expect(res.averageRating).toBe(4);
  });
});

describe('item 2: reputation', () => {
  it('new user gets the prior mean and no raw average', async () => {
    const u = await seedUser('fresh');
    const r = await service.getReputation(u.id);
    expect(r.reviewCount).toBe(0);
    expect(r.rawAverage).toBeNull();
    expect(r.reputationScore).toBe(3.5);
  });

  it('score follows the documented formula and stays within 1-5', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 5 }); // about owner
    await service.create(s.owner.id, { borrowRequestId: s.loan.id, rating: 3 });    // about borrower
    const owner = await service.getReputation(s.owner.id);
    const borrower = await service.getReputation(s.borrower.id);
    expect(owner.reputationScore).toBe(3.75);    // (5*3.5 + 5) / (5 + 1)
    expect(borrower.reputationScore).toBe(3.42); // (5*3.5 + 3) / (5 + 1) = 3.4167
    for (const r of [owner, borrower]) {
      expect(r.reputationScore).toBeGreaterThanOrEqual(1);
      expect(r.reputationScore).toBeLessThanOrEqual(5);
    }
  });
});

describe('pagination', () => {
  it('listForResource really paginates', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    for (let i = 0; i < 7; i++) {
      const borrower = await seedUser('b');
      const loan = await addLoan(s.owner, borrower, s.resource, BorrowStatus.RETURNED);
      await service.create(borrower.id, { borrowRequestId: loan.id, rating: 4 });
    }
    await closeWindow(s.resource.id);
    const page1 = await service.listForResource(s.resource.id, s.owner.id, 1, 3);
    const page3 = await service.listForResource(s.resource.id, s.owner.id, 3, 3);
    expect(page1.reviewCount).toBe(7);
    expect(page1.items).toHaveLength(3);
    expect(page1.totalPages).toBe(3);
    expect(page3.items).toHaveLength(1);
  });
});

describe('blind reviews', () => {
  it('a lone review stays private until the other side reviews', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 4 });
    expect((await service.listForResource(s.resource.id, s.owner.id)).reviewCount).toBe(0);
    await service.create(s.owner.id, { borrowRequestId: s.loan.id, rating: 2 });
    const result = await service.listForResource(s.resource.id, s.owner.id);
    expect(result.reviewCount).toBe(1);
    expect(result.averageRating).toBe(4);
  });

  it('a lone review becomes public once the window closes', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 5 });
    await closeWindow(s.resource.id);
    expect((await service.listForResource(s.resource.id, s.owner.id)).reviewCount).toBe(1);
  });

  it('no review can be written after the window closes', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await ds.query(
      'UPDATE loan_events SET createdAt = ? WHERE borrowRequestId = ? AND eventType = ?',
      [new Date(Date.now() - 15 * 86_400_000), s.loan.id, LoanEventType.RETURNED],
    );
    await expect(
      service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.getEligibility(s.loan.id, s.borrower.id)).reason).toBe(
      'window_closed',
    );
  });

  it('a loan without a handover event cannot be reviewed', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await ds.query(
      'DELETE FROM loan_events WHERE borrowRequestId = ? AND eventType = ?',
      [s.loan.id, LoanEventType.HANDED_OVER],
    );
    await expect(
      service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('moderation', () => {
  it('hidden reviews leave rating and reputation; unhide restores them', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    const review = await service.create(s.borrower.id, {
      borrowRequestId: s.loan.id,
      rating: 1,
    });
    await service.create(s.owner.id, { borrowRequestId: s.loan.id, rating: 5 });
    expect((await service.getReputation(s.owner.id)).reviewCount).toBe(1);

    await expect(
    service.setHidden({ id: s.stranger.id, role: 'admin' }, review.id, true) 
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.setHidden({ id: s.stranger.id, role: 'admin' }, review.id, true, 'abusive')
    expect((await service.listForResource(s.resource.id, s.owner.id)).reviewCount).toBe(0);
    expect((await service.getReputation(s.owner.id)).reviewCount).toBe(0);
    expect(
      auditCalls.some(
        (entry) => entry.action === 'review.hidden' && entry.targetId === review.id,
      ),
    ).toBe(true);

    await service.setHidden({ id: s.stranger.id, role: 'admin' }, review.id, false)
    expect((await service.getReputation(s.owner.id)).reviewCount).toBe(1);
  });

  it('reports only visible reviews and records reports', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    const review = await service.create(s.borrower.id, {
      borrowRequestId: s.loan.id,
      rating: 5,
    });
    await expect(service.report(s.owner.id, review.id, 'spam')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.create(s.owner.id, { borrowRequestId: s.loan.id, rating: 3 });
    await expect(service.report(s.borrower.id, review.id, 'spam')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await service.report(s.owner.id, review.id, 'looks fake');
    expect(
      auditCalls.some(
        (entry) => entry.action === 'review.reported' && entry.targetId === review.id,
      ),
    ).toBe(true);
  });
});

describe('collusion cap', () => {
  it('five loans between the same pair count as one vote', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    await service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 5 });
    for (let i = 0; i < 4; i++) {
      const loan = await addLoan(s.owner, s.borrower, s.resource, BorrowStatus.RETURNED);
      await service.create(s.borrower.id, { borrowRequestId: loan.id, rating: 5 });
    }
    await closeWindow(s.resource.id);
    const reputation = await service.getReputation(s.owner.id);
    expect(reputation.reviewCount).toBe(1);
    expect(reputation.reputationScore).toBe(3.75);
  });
});

describe('time handling (UTC)', () => {
  it('window = RETURNED event time + 14 days, with no timezone shift', async () => {
    const s = await seedLoan(BorrowStatus.RETURNED);
    const review = await service.create(s.borrower.id, { borrowRequestId: s.loan.id, rating: 5 });

    const returned = await ds
      .getRepository(LoanEvent)
      .findOneByOrFail({ borrowRequestId: s.loan.id, eventType: LoanEventType.RETURNED });

    // DB default timestamp read back through the driver must be "now", not now - 6h
    expect(Math.abs(returned.createdAt.getTime() - Date.now())).toBeLessThan(2 * 60_000);

    // window is derived from that timestamp
    const expected = returned.createdAt.getTime() + REVIEW_WINDOW_DAYS * 86_400_000;
    expect(Math.abs(review.windowClosesAt.getTime() - expected)).toBeLessThan(1000);

    // what is physically stored, measured against the DB's own UTC clock (driver not involved)
    const [row] = await ds.query(
      'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(6), windowClosesAt) AS secs FROM reviews WHERE id = ?',
      [review.id],
    );
    expect(Math.abs(Number(row.secs) - REVIEW_WINDOW_DAYS * 86_400)).toBeLessThan(120);
  });
});