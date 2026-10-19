import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { Resource } from '../src/resources/entities/resource.entity.js';
import { BorrowRequest, BorrowStatus } from '../src/borrow-requests/entities/borrow-request.entity.js';
import { CreateUsers1791838335819 } from '../src/database/migrations/1791838335819-CreateUsers.js';
import { CreateResourcesAndBorrowRequests1791900000000 } from '../src/database/migrations/1791900000000-CreateResourcesAndBorrowRequests.js';
import { BorrowRequestsService } from '../src/borrow-requests/borrow-requests.service.js';
import { isDuplicateEntry } from '../src/common/db-errors.js';
import { ResourceCategory } from '../src/resources/entities/resource-category.entity.js';
import { ResourceImage } from '../src/resources/entities/resource-image.entity.js';
import { ResourceFavorite } from '../src/resources/entities/resource-favorite.entity.js';
import { ResourceMarketplace1792000000000 } from '../src/database/migrations/1792000000000-ResourceMarketplace.js';
import { LoanEvent, LoanEventType } from '../src/borrow-requests/entities/loan-event.entity.js';
import { CreateLoanEvents1792100000000 } from '../src/database/migrations/1792100000000-CreateLoanEvents.js';
import { AddEmailCanonical1792700000000 } from '../src/database/migrations/1792700000000-AddEmailCanonical.js';
import { CreateNotifications1792800000000 } from '../src/database/migrations/1792800000000-CreateNotifications.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { ResourcesService } from '../src/resources/resources.service.js';
import { ImageStorageService } from '../src/resources/storage/image-storage.service.js';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../src/notifications/notifications.service.js';
let ds: DataSource;
let service: BorrowRequestsService;

const BORROWERS = 10;
const ROUNDS = 20;

async function seedUser(label: string) {
  return ds.getRepository(User).save(
    ds.getRepository(User).create({
      name: label,
      email: `${label}-${Math.random().toString(36).slice(2)}@test.local`,
      passwordHash: 'x',
      campus: 'test',
      role: UserRole.STUDENT,
      emailVerifiedAt: null,
    }),
  );
}

async function seedScenario(borrowerCount: number) {
  const owner = await seedUser('owner');
  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const resource = await ds.getRepository(Resource).save(
    ds.getRepository(Resource).create({
      ownerId: owner.id,
      categoryId: category.id,
      title: 'Scientific calculator',
      description: null,
      isListed: true,
    }),
  );
  const requests: BorrowRequest[] = [];
  for (let i = 0; i < borrowerCount; i++) {
    const borrower = await seedUser(`borrower${i}`);
    requests.push(
      await ds.getRepository(BorrowRequest).save(
        ds.getRepository(BorrowRequest).create({
          resourceId: resource.id,
          borrowerId: borrower.id,
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          message: null,
          status: BorrowStatus.PENDING,
        }),
      ),
    );
  }
  return { owner, resource, requests };
}

beforeAll(async () => {
  ds = new DataSource({
    type: 'mysql',
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT ?? 3317),
    username: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? 'root',
    database: process.env.TEST_DB_NAME ?? 'campusloop_test',
    entities: [User, Resource, BorrowRequest, ResourceCategory, ResourceImage, ResourceFavorite, LoanEvent, Notification],
    migrations: [AddEmailCanonical1792700000000,
      CreateUsers1791838335819,
      CreateResourcesAndBorrowRequests1791900000000,
      ResourceMarketplace1792000000000,
      CreateLoanEvents1792100000000,
      CreateNotifications1792800000000,
    ],
    dropSchema: false,
    synchronize: false,
    extra: { connectionLimit: 30 },
  });
  await ds.initialize();
  await ds.runMigrations(); // runs the REAL migrations, including the generated column
const notificationsMock = {
  notifyBorrowEvent: vi.fn().mockResolvedValue(undefined),
} as unknown as NotificationsService;

service = new BorrowRequestsService(
  ds,
  new JwtService({
    secret: process.env.JWT_SECRET ?? 'qr-test-secret',
  }),
  notificationsMock,
);
}, 60_000);

afterAll(async () => {
  if (!ds?.isInitialized) return;
  try {
    await ds.query(`DELETE le FROM loan_events le JOIN resources r ON r.id = le.resourceId JOIN users u ON u.id = r.ownerId WHERE u.email LIKE '%@test.local'`);
    await ds.query(`DELETE br FROM borrow_requests br JOIN resources r ON r.id = br.resourceId JOIN users u ON u.id = r.ownerId WHERE u.email LIKE '%@test.local'`);
    await ds.query(`DELETE FROM resources WHERE ownerId IN (SELECT id FROM users WHERE email LIKE '%@test.local')`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@test.local'`);
  } finally {
    await ds.destroy();
  }
});

describe('double-booking protection', () => {
    it(`exactly one of ${BORROWERS} simultaneous approvals succeeds (x${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { owner, resource, requests } = await seedScenario(BORROWERS);

      const results = await Promise.allSettled(
        requests.map((r) => service.approve(r.id, owner.id)),
      );

      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(BORROWERS - 1);
      for (const f of failed) {
        expect(f.reason).toBeInstanceOf(ConflictException);
      }

      const approved = await ds.getRepository(BorrowRequest).count({
        where: { resourceId: resource.id, status: BorrowStatus.APPROVED },
      });
      expect(approved).toBe(1);

      const approvedEvents = await ds.getRepository(LoanEvent).count({
        where: { resourceId: resource.id, eventType: LoanEventType.APPROVED },
      });
      expect(approvedEvents).toBe(1); // losers leave no event behind
    }
  }, 120_000);

  it('database itself rejects a second active loan even if app code is bypassed', async () => {
    const { requests } = await seedScenario(2);
    await ds.query(`UPDATE borrow_requests SET status='approved' WHERE id=?`, [requests[0].id]);

    let error: unknown;
    try {
      await ds.query(`UPDATE borrow_requests SET status='approved' WHERE id=?`, [requests[1].id]);
    } catch (e) {
      error = e;
    }
    expect(isDuplicateEntry(error)).toBe(true);
  });

  it('resource is released after return and can then be approved for another borrower', async () => {
    const { owner, requests } = await seedScenario(2);

    await service.approve(requests[0].id, owner.id);
    await expect(service.approve(requests[1].id, owner.id)).rejects.toBeInstanceOf(ConflictException);

    await service.markReturned(requests[0].id, owner.id);
    await expect(service.approve(requests[1].id, owner.id)).resolves.toMatchObject({
      status: BorrowStatus.APPROVED,
    });
  });

  it('non-owner cannot approve', async () => {
    const { requests } = await seedScenario(1);
    const stranger = await seedUser('stranger');
    await expect(service.approve(requests[0].id, stranger.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('borrower can cancel an approved request, which frees the resource', async () => {
    const { owner, requests } = await seedScenario(2);

    await service.approve(requests[0].id, owner.id);
    await expect(service.approve(requests[1].id, owner.id)).rejects.toBeInstanceOf(ConflictException);

    await service.cancel(requests[0].id, requests[0].borrowerId);
    await expect(service.approve(requests[1].id, owner.id)).resolves.toMatchObject({
      status: BorrowStatus.APPROVED,
    });
  });

  it('only the borrower can cancel', async () => {
    const { owner, requests } = await seedScenario(1);
    await expect(service.cancel(requests[0].id, owner.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approving a request whose due date has passed marks it expired and does not occupy the resource', async () => {
    const { owner, requests } = await seedScenario(2);
    await ds.query(`UPDATE borrow_requests SET dueDate = ? WHERE id = ?`, [
      new Date(Date.now() - 60_000),
      requests[0].id,
    ]);

    await expect(service.approve(requests[0].id, owner.id)).rejects.toBeInstanceOf(ConflictException);

    const stored = await ds.getRepository(BorrowRequest).findOneByOrFail({ id: requests[0].id });
    expect(stored.status).toBe(BorrowStatus.EXPIRED);

    // The resource is still free for the next borrower.
    await expect(service.approve(requests[1].id, owner.id)).resolves.toMatchObject({
      status: BorrowStatus.APPROVED,
    });
        const expiredEvents = await ds.getRepository(LoanEvent).find({
      where: { borrowRequestId: requests[0].id },
    });
    expect(expiredEvents.map((e) => e.eventType)).toEqual([LoanEventType.EXPIRED]);
    expect(expiredEvents[0].actorId).toBeNull();
  });
});
describe('loan event history', () => {
  async function seedResource() {
    const owner = await seedUser('owner');
    const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
    const resource = await ds.getRepository(Resource).save(
      ds.getRepository(Resource).create({
        ownerId: owner.id,
        categoryId: category.id,
        title: 'Lab coat',
        description: null,
        isListed: true,
      }),
    );
    return { owner, resource };
  }

  it('records requested, approved and returned in order with a consistent status chain', async () => {
    const { owner, resource } = await seedResource();
    const borrower = await seedUser('borrower');

    const req = await service.create(borrower.id, {
      resourceId: resource.id,
      dueDate: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    });
    await service.approve(req.id, owner.id);
    await service.markReturned(req.id, owner.id);

    const history = await service.history(req.id, borrower.id);
    expect(history.items.map((e) => e.eventType)).toEqual(['requested', 'approved', 'returned']);
    expect(history.items.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, 'pending'],
      ['pending', 'approved'],
      ['approved', 'returned'],
    ]);
    expect(history.items[1].actor?.id).toBe(owner.id);
    expect(history.items[2].eventType).toBe(LoanEventType.RETURNED);
expect(history.items[2].actor?.id).toBe(owner.id);
expect(history.items[2].note).toContain('not independently verified');
  });

  it('records a cancelled event when the borrower withdraws an approved request', async () => {
    const { owner, resource } = await seedResource();
    const borrower = await seedUser('borrower');
    const req = await service.create(borrower.id, {
      resourceId: resource.id,
      dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    await service.approve(req.id, owner.id);
    await service.cancel(req.id, borrower.id);

    const history = await service.history(req.id, owner.id);
    expect(history.items.map((e) => e.eventType)).toEqual(['requested', 'approved', 'cancelled']);
    expect(history.items[2].fromStatus).toBe('approved');
  });

  it('only the borrower and the owner can read the history', async () => {
    const { owner, resource } = await seedResource();
    const borrower = await seedUser('borrower');
    const stranger = await seedUser('stranger');
    const req = await service.create(borrower.id, {
      resourceId: resource.id,
      dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });

    await expect(service.history(req.id, owner.id)).resolves.toBeDefined();
    await expect(service.history(req.id, borrower.id)).resolves.toBeDefined();
    await expect(service.history(req.id, stranger.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('removing a resource cancels pending requests and records one event for each', async () => {
    const { owner, resource, requests } = await seedScenario(3);
    const resources = new ResourcesService(ds, new ImageStorageService());

    const result = await resources.remove(resource.id, owner.id);
    expect(result.cancelledPendingRequests).toBe(3);

    const events = await ds.getRepository(LoanEvent).find({ where: { resourceId: resource.id } });
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.eventType === LoanEventType.CANCELLED)).toBe(true);

    const rows = await ds.getRepository(BorrowRequest).find({ where: { resourceId: resource.id } });
    expect(rows.every((r) => r.status === BorrowStatus.CANCELLED)).toBe(true);
    expect(requests).toHaveLength(3);
  });
  it('rejects a non-owner attempting to mark a loan returned', async () => {
  const { owner, resource } = await seedResource();
  const borrower = await seedUser('borrower');
  const stranger = await seedUser('stranger');

  const req = await service.create(borrower.id, {
    resourceId: resource.id,
    dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });

  await service.approve(req.id, owner.id);

  await expect(
    service.markReturned(req.id, stranger.id),
  ).rejects.toBeInstanceOf(ForbiddenException);

  const stored = await ds.getRepository(BorrowRequest).findOneByOrFail({
    id: req.id,
  });
  expect(stored.status).toBe(BorrowStatus.APPROVED);

  const history = await service.history(req.id, borrower.id);
  expect(history.items.map((event) => event.eventType)).toEqual([
    'requested',
    'approved',
  ]);
});
});