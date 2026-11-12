import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { User, UserRole } from '../src/users/entities/user.entity.js';

// GET /admin/audit-logs and GET /admin/analytics over the real HTTP stack and MySQL.
// Test app has NO global "api" prefix.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `ana-${RUN}`;
const OTHER = `ana-other-${RUN}`;
/** Only the analytics seed lives here, so its counts are exact whatever the other tests create. */
const SEEDED = `ana-seeded-${RUN}`;

let app: INestApplication;
let ds: DataSource;
let ipCounter = 0;
const userIds: string[] = [];
const categoryIds: string[] = [];

type Actor = { id: string; ip: string; token: string; email: string };
type AuditItem = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actor: { name: string; email: string } | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
};

const server = () => app.getHttpServer();
const nextIp = () => `198.51.110.${(++ipCounter % 250) + 1}`;
const call = (method: 'get' | 'post' | 'patch', url: string, who?: Actor) => {
  const req = request(server())[method](url).set('X-Forwarded-For', who?.ip ?? nextIp());
  return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
};

async function makeUser(label: string, opts: { role?: UserRole; campus?: string; login?: boolean } = {}): Promise<Actor> {
  const email = `ana-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({
      name: `ana-${label}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      campus: opts.campus ?? CAMPUS,
      role: opts.role ?? UserRole.STUDENT,
      emailVerifiedAt: new Date(),
    }),
  );
  userIds.push(user.id);
  if (opts.login === false) return { id: user.id, ip: '', token: '', email };
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password: PASSWORD }).expect(201);
  return { id: user.id, ip: nextIp(), token: res.body.accessToken, email };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({ send: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  ds = app.get(DataSource);
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await ds.query(`DELETE FROM study_groups WHERE creatorId IN (${marks})`, userIds);
      await ds.query(`DELETE FROM lost_found_reports WHERE reporterId IN (${marks})`, userIds); // claims cascade
      await ds.query(
        `DELETE br FROM borrow_requests br JOIN resources r ON r.id = br.resourceId WHERE r.ownerId IN (${marks})`,
        userIds,
      );
      await ds.query(`DELETE FROM resources WHERE ownerId IN (${marks})`, userIds);
      await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, userIds);
      await ds.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    if (categoryIds.length) {
      await ds.query(`DELETE FROM resource_categories WHERE id IN (${categoryIds.map(() => '?').join(',')})`, categoryIds);
    }
  }
  await app?.close();
});

describe('access', () => {
  it('not logged in: 401; students and moderators: 403', async () => {
    await call('get', '/admin/audit-logs').expect(401);
    await call('get', '/admin/analytics').expect(401);
    for (const who of [await makeUser('acc-student'), await makeUser('acc-mod', { role: UserRole.MODERATOR })]) {
      await call('get', '/admin/audit-logs', who).expect(403);
      await call('get', '/admin/analytics', who).expect(403);
    }
  });
});

describe('GET /admin/audit-logs', () => {
  let admin: Actor;
  let target: Actor;

  const logs = async (query: string) =>
    (await call('get', `/admin/audit-logs?${query}`, admin).expect(200)).body as { data: AuditItem[]; pagination: { total: number; pages: number } };

  beforeAll(async () => {
    admin = await makeUser('audit-admin', { role: UserRole.ADMIN });
    target = await makeUser('audit-target');
    // Three audited actions by this admin, in order.
    await call('patch', `/admin/users/${target.id}/role`, admin).send({ role: 'moderator' }).expect(200);
    await call('patch', `/admin/users/${target.id}/deactivate`, admin).expect(200);
    await call('patch', `/admin/users/${target.id}/reactivate`, admin).expect(200);
  });

  it("filters by actor, newest first, with the actor's name and email and the IP address", async () => {
    const { data, pagination } = await logs(`actorId=${admin.id}`);
    expect(pagination.total).toBe(3);
    expect(data.map((d) => d.action)).toEqual(['user.reactivated', 'user.deactivated', 'user.role_changed']);
    for (const item of data) {
      expect(item).toMatchObject({ actorId: admin.id, actor: { name: 'ana-audit-admin', email: admin.email }, targetType: 'user', targetId: target.id, ipAddress: admin.ip });
      expect(Object.keys(item).sort()).toEqual(['action', 'actor', 'actorId', 'createdAt', 'id', 'ipAddress', 'metadata', 'targetId', 'targetType']);
    }
    expect(data[2].metadata).toEqual({ from: 'student', to: 'moderator' });
  });

  it('filters by action and by date range; a date-only "to" covers the whole day', async () => {
    expect((await logs(`actorId=${admin.id}&action=user.deactivated`)).data.map((d) => d.action)).toEqual(['user.deactivated']);

    const today = new Date().toISOString().slice(0, 10);
    expect((await logs(`actorId=${admin.id}&from=${today}&to=${today}`)).pagination.total).toBe(3);
    expect((await logs(`actorId=${admin.id}&from=2999-01-01`)).data).toEqual([]);
    expect((await logs(`actorId=${admin.id}&to=2000-01-01`)).data).toEqual([]);
  });

  it('paginates', async () => {
    const page1 = await logs(`actorId=${admin.id}&limit=2&page=1`);
    const page2 = await logs(`actorId=${admin.id}&limit=2&page=2`);
    expect(page1.pagination.pages).toBe(2);
    expect([...page1.data, ...page2.data].map((d) => d.action)).toEqual(['user.reactivated', 'user.deactivated', 'user.role_changed']);
  });

  it('rejects invalid filters with 400', async () => {
    for (const query of ['actorId=not-a-uuid', 'from=yesterday', 'from=2026-11-02&to=2026-11-01', 'action=DROP TABLE', 'limit=1000', 'page=0']) {
      await call('get', `/admin/audit-logs?${query}`, admin).expect(400);
    }
  });

  it('never exposes password or token hashes', async () => {
    const { data } = await logs('limit=100');
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|tokenHash|\$2[aby]\$/);
  });
});

describe('GET /admin/analytics', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await makeUser('ana-admin', { role: UserRole.ADMIN, campus: OTHER });

    // Campus SEEDED: 3 users (1 deactivated), 3 listed resources + 1 deleted.
    const owner = await makeUser('owner', { login: false, campus: SEEDED });
    const borrower = await makeUser('borrower', { login: false, campus: SEEDED });
    const gone = await makeUser('gone', { login: false, campus: SEEDED });
    await ds.query('UPDATE users SET deactivatedAt = ? WHERE id = ?', [new Date(), gone.id]);

    const categoryId = randomUUID();
    categoryIds.push(categoryId);
    await ds.query('INSERT INTO resource_categories (id, name, slug) VALUES (?, ?, ?)', [categoryId, `Ana ${RUN}`, `ana-${RUN}`]);
    const resources = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of resources) {
      await ds.query('INSERT INTO resources (id, ownerId, categoryId, title) VALUES (?, ?, ?, ?)', [id, owner.id, categoryId, 'Seeded']);
    }
    await ds.query('UPDATE resources SET deletedAt = ? WHERE id = ?', [new Date(), resources[3]]);

    // Loans: one active on each of two resources (only one occupying loan per resource), and
    // pending, returned and expired on the third.
    const due = new Date(Date.now() + 7 * 86_400_000);
    const loans: Array<[string, string]> = [
      [resources[0], 'active'],
      [resources[1], 'active'],
      [resources[2], 'pending'],
      [resources[2], 'returned'],
      [resources[2], 'expired'],
    ];
    for (const [resourceId, status] of loans) {
      await ds.query('INSERT INTO borrow_requests (id, resourceId, borrowerId, status, dueDate) VALUES (?, ?, ?, ?, ?)', [
        randomUUID(),
        resourceId,
        borrower.id,
        status,
        due,
      ]);
    }

    // Lost and found: 2 lost open, 1 found resolved; claims: 1 pending, 1 rejected.
    const report = (type: string, status: string) => {
      const id = randomUUID();
      return ds
        .query(
          `INSERT INTO lost_found_reports (id, reporterId, campus, type, title, description, category, location, itemDate, status)
           VALUES (?, ?, ?, ?, 'Seeded', 'Seeded description', 'Misc', 'Hall', '2026-10-01', ?)`,
          [id, owner.id, SEEDED, type, status],
        )
        .then(() => id);
    };
    await report('lost', 'open');
    await report('lost', 'open');
    const found = await report('found', 'resolved');
    // One claim per (report, claimant) is a DB constraint, so two different claimants.
    for (const [claimantId, status] of [[borrower.id, 'pending'], [gone.id, 'rejected']]) {
      await ds.query('INSERT INTO lost_found_claims (id, reportId, claimantId, campus, proofDetails, status) VALUES (?, ?, ?, ?, ?, ?)', [
        randomUUID(),
        found,
        claimantId,
        SEEDED,
        'Seeded proof details for analytics.',
        status,
      ]);
    }

    // Study groups: 1 open, 1 archived.
    for (const status of ['open', 'archived']) {
      await ds.query(
        `INSERT INTO study_groups (id, creatorId, campus, title, courseCode, topic, description, schedule, participantLimit, status)
         VALUES (?, ?, ?, 'Seeded group', 'ANA101', 'Seeding', 'Seeded description', 'Any time', 5, ?)`,
        [randomUUID(), owner.id, SEEDED, status],
      );
    }
  });

  it('returns exact per-campus counts for a seeded campus', async () => {
    const res = await call('get', '/admin/analytics', admin).expect(200);
    const row = (res.body.campuses as Array<{ campus: string }>).find((c) => c.campus === SEEDED);
    expect(row).toEqual({
      campus: SEEDED,
      users: { total: 3, active: 2, deactivated: 1 },
      resources: 3,
      activeLoans: 2,
      loans: { pending: 1, approved: 0, active: 2, returned: 1, rejected: 0, cancelled: 0, expired: 1 },
      lostFound: { lost: { open: 2, resolved: 0 }, found: { open: 0, resolved: 1 } },
      claims: { pending: 1, approved: 0, rejected: 1 },
      studyGroups: { open: 1, archived: 1 },
    });
  });

  it("keeps campuses apart (the admin's own campus has only the admin) and totals cover every campus", async () => {
    const body = (await call('get', '/admin/analytics', admin).expect(200)).body as {
      generatedAt: string;
      campuses: Array<{ campus: string; users: { total: number }; resources: number }>;
      totals: { users: { total: number }; resources: number; activeLoans: number };
    };
    expect(body.campuses.find((c) => c.campus === OTHER)).toMatchObject({ users: { total: 1 }, resources: 0 });
    const sum = (pick: (c: (typeof body.campuses)[number]) => number) => body.campuses.reduce((total, c) => total + pick(c), 0);
    expect(body.totals.users.total).toBe(sum((c) => c.users.total));
    expect(body.totals.resources).toBe(sum((c) => c.resources));
    expect(body.totals.activeLoans).toBeGreaterThanOrEqual(2);
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
  });
});
