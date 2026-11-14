import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { Resource } from '../src/resources/entities/resource.entity.js';
import { ResourceCategory } from '../src/resources/entities/resource-category.entity.js';
import { ResourceImage } from '../src/resources/entities/resource-image.entity.js';
import { ResourceFavorite } from '../src/resources/entities/resource-favorite.entity.js';
import { BorrowRequest, BorrowStatus } from '../src/borrow-requests/entities/borrow-request.entity.js';
import { LoanEvent, LoanEventType } from '../src/borrow-requests/entities/loan-event.entity.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { BorrowRequestsService } from '../src/borrow-requests/borrow-requests.service.js';
import { BorrowExpiryService } from '../src/borrow-requests/borrow-expiry.service.js';
import type { NotificationsService } from '../src/notifications/notifications.service.js';
import { MIGRATIONS_GLOB } from '../src/database/migrations-glob.js';

const HOUR = 3_600_000;
const EMAIL_DOMAIN = '@expiry.test.local';

let ds: DataSource;
let borrow: BorrowRequestsService;
let expiry: BorrowExpiryService;
const notifyBorrowEvent = vi.fn().mockResolvedValue(undefined);

const rand = () => Math.random().toString(36).slice(2, 10);

async function seedUser(label: string) {
  const repo = ds.getRepository(User);
  return repo.save(repo.create({
    name: label, email: `${label}-${rand()}${EMAIL_DOMAIN}`, passwordHash: 'x',
    campus: 'test', role: UserRole.STUDENT, emailVerifiedAt: null,
  }));
}

async function seedResource() {
  const owner = await seedUser('owner');
  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const repo = ds.getRepository(Resource);
  const resource = await repo.save(repo.create({
    ownerId: owner.id, categoryId: category.id, title: 'Expiry calc', description: null, isListed: true,
  }));
  return { owner, resource };
}

async function seedRequest(resourceId: string, dueInHours = 7 * 24) {
  const borrower = await seedUser('borrower');
  const repo = ds.getRepository(BorrowRequest);
  const request = await repo.save(repo.create({
    resourceId, borrowerId: borrower.id, dueDate: new Date(Date.now() + dueInHours * HOUR),
    message: null, status: BorrowStatus.PENDING,
  }));
  return { borrower, request };
}

/** A real approval through the service, so approvedAt is stamped exactly as in production. */
async function seedApproved() {
  const { owner, resource } = await seedResource();
  const { borrower, request } = await seedRequest(resource.id);
  await borrow.approve(request.id, owner.id);
  return { owner, resource, borrower, request };
}

const statusOf = async (id: string) => (await ds.getRepository(BorrowRequest).findOneByOrFail({ id })).status;
const expiredEvents = (ids: string[]) =>
  ds.getRepository(LoanEvent).find({ where: { borrowRequestId: In(ids), eventType: LoanEventType.EXPIRED } });
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR);

beforeAll(async () => {
  ds = new DataSource({
    type: 'mysql',
    timezone: 'Z',
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT ?? 3317),
    username: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? 'root',
    database: process.env.TEST_DB_NAME ?? 'campusloop_test',
    entities: [User, Resource, BorrowRequest, ResourceCategory, ResourceImage, ResourceFavorite, LoanEvent, Notification],
    migrations: [MIGRATIONS_GLOB],
    extra: { connectionLimit: 30 },
  });
  await ds.initialize();
  await ds.runMigrations();

  const notifications = { notifyBorrowEvent } as unknown as NotificationsService;
  borrow = new BorrowRequestsService(ds, new JwtService({ secret: 'expiry-test-secret' }), notifications);
  expiry = new BorrowExpiryService(
    ds,
    new ConfigService({ BORROW_PICKUP_WINDOW_HOURS: '48', BORROW_EXPIRY_SWEEP_ENABLED: 'false' }),
    notifications,
  );
}, 60_000);

beforeEach(() => notifyBorrowEvent.mockClear());

afterAll(async () => {
  if (!ds?.isInitialized) return;
  const owners = `SELECT id FROM users WHERE email LIKE '%${EMAIL_DOMAIN}'`;
  // loan_events are immutable history, so remove them explicitly before their requests.
  await ds.query(`DELETE le FROM loan_events le JOIN borrow_requests br ON br.id = le.borrowRequestId
                  WHERE br.borrowerId IN (${owners})`);
  await ds.query(`DELETE FROM borrow_requests WHERE borrowerId IN (${owners})`);
  await ds.query(`DELETE FROM resources WHERE ownerId IN (${owners})`);
  await ds.query(`DELETE FROM users WHERE email LIKE '%${EMAIL_DOMAIN}'`);
  await ds.destroy();
});

describe('approve stamps approvedAt', () => {
  it('records the approval time on the request', async () => {
    const before = Date.now();
    const { request } = await seedApproved();
    const row = await ds.getRepository(BorrowRequest).findOneByOrFail({ id: request.id });
    expect(row.approvedAt).not.toBeNull();
    expect(row.approvedAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });
});

describe('approved but never picked up', () => {
  it('expires after the pickup window and releases the resource for the next borrower', async () => {
    const { owner, resource, request } = await seedApproved();
    const { request: next } = await seedRequest(resource.id);
    // While the stale approval holds the resource, nobody else can be approved.
    await expect(borrow.approve(next.id, owner.id)).rejects.toThrow(/already on loan/);

    await expiry.expireStale(at(49));

    expect(await statusOf(request.id)).toBe(BorrowStatus.EXPIRED);
    const [event] = await expiredEvents([request.id]);
    expect(event).toMatchObject({ actorId: null, fromStatus: BorrowStatus.APPROVED, toStatus: BorrowStatus.EXPIRED });
    expect(event.note).toMatch(/pickup window/);
    expect(notifyBorrowEvent).toHaveBeenCalledWith(request.id, 'pickup-expired');

    await borrow.approve(next.id, owner.id); // the resource is free again
    expect(await statusOf(next.id)).toBe(BorrowStatus.APPROVED);
  });

  it('leaves an approval alone while it is still inside the window', async () => {
    const { request } = await seedApproved();
    await expiry.expireStale(at(47));
    expect(await statusOf(request.id)).toBe(BorrowStatus.APPROVED);
    expect(notifyBorrowEvent).not.toHaveBeenCalledWith(request.id, 'pickup-expired');
  });

  it('expires an approval whose due date passed, even inside the window', async () => {
    const { owner, resource } = await seedResource();
    const { request } = await seedRequest(resource.id, 2); // due in 2 h
    await borrow.approve(request.id, owner.id);
    await expiry.expireStale(at(3));
    expect(await statusOf(request.id)).toBe(BorrowStatus.EXPIRED);
    expect((await expiredEvents([request.id]))[0].note).toMatch(/due date/);
  });

  it('still cleans up when the resource was soft-deleted', async () => {
    const { resource, request } = await seedApproved();
    await ds.getRepository(Resource).softDelete(resource.id);
    await expiry.expireStale(at(49));
    expect(await statusOf(request.id)).toBe(BorrowStatus.EXPIRED);
  });
});

describe('pending', () => {
  it('expires once its due date passed, and notifies with the pending message', async () => {
    const { resource } = await seedResource();
    const { request } = await seedRequest(resource.id, 2);
    await expiry.expireStale(at(3));
    expect(await statusOf(request.id)).toBe(BorrowStatus.EXPIRED);
    expect(notifyBorrowEvent).toHaveBeenCalledWith(request.id, 'expired');
  });

  it('is not touched while its due date is in the future', async () => {
    const { resource } = await seedResource();
    const { request } = await seedRequest(resource.id);
    await expiry.expireStale(at(49));
    expect(await statusOf(request.id)).toBe(BorrowStatus.PENDING);
  });
});

describe('never touches loans that actually started', () => {
  it('an overdue ACTIVE loan stays active (overdue is not expired)', async () => {
    const { request } = await seedApproved();
    await ds.getRepository(BorrowRequest).update({ id: request.id }, { status: BorrowStatus.ACTIVE });
    await expiry.expireStale(at(30 * 24));
    expect(await statusOf(request.id)).toBe(BorrowStatus.ACTIVE);
  });
});

describe('concurrency', () => {
  it('five overlapping sweeps expire each stale request exactly once', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await seedApproved()).request.id);

    await Promise.all(Array.from({ length: 5 }, () => expiry.expireStale(at(49))));

    expect((await ds.getRepository(BorrowRequest).findBy({ id: In(ids) })).every((r) => r.status === BorrowStatus.EXPIRED)).toBe(true);
    const events = await expiredEvents(ids);
    expect(events).toHaveLength(ids.length); // one event per request, no duplicates
    const expiryNotices = notifyBorrowEvent.mock.calls.filter(([id, event]) => ids.includes(id as string) && event === 'pickup-expired');
    expect(expiryNotices).toHaveLength(ids.length); // approve() also notifies; count only expiries
  });

  it('a borrower cancelling during a sweep: exactly one transition wins', async () => {
    for (let round = 0; round < 10; round++) {
      const { borrower, request } = await seedApproved();
      const [cancel] = await Promise.allSettled([borrow.cancel(request.id, borrower.id), expiry.expireStale(at(49))]);

      const final = await statusOf(request.id);
      expect([BorrowStatus.CANCELLED, BorrowStatus.EXPIRED]).toContain(final);
      // The loser must not have written a second terminal event.
      const terminal = await ds.getRepository(LoanEvent).find({
        where: { borrowRequestId: request.id, eventType: In([LoanEventType.CANCELLED, LoanEventType.EXPIRED]) },
      });
      expect(terminal).toHaveLength(1);
      if (final === BorrowStatus.EXPIRED) expect(cancel.status).toBe('rejected'); // cancel saw "expired" and refused
    }
  });
});
