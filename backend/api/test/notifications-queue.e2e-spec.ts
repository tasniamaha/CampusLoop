import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { MailService, type MailMessage } from '../src/mail/mail.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { Resource } from '../src/resources/entities/resource.entity.js';
import { ResourceCategory } from '../src/resources/entities/resource-category.entity.js';

const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6390';
const redisHost = new URL(redisUrl).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(redisHost)) {
  throw new Error(`Refusing to run against non-local Redis host "${redisHost}"`);
}
process.env.NOTIFICATIONS_QUEUE_ENABLED = 'true';
process.env.REDIS_URL = redisUrl;
process.env.BULLMQ_PREFIX = `campusloop-test-${randomUUID().slice(0, 8)}`; // never touches dev queues

const PASSWORD = 'correct-horse-battery';
const MAIL = 'notif-e2e-';
let app: INestApplication;
let ds: DataSource;
let svc: NotificationsService;
const sent: MailMessage[] = [];
const fakeMail = { send: async (m: MailMessage) => void sent.push(m) };
const server = () => app.getHttpServer();
const rand = () => Math.random().toString(36).slice(2, 10);

async function waitFor(pred: () => boolean | Promise<boolean>, ms = 8_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function seedUser(label: string, role = UserRole.STUDENT) {
  const repo = ds.getRepository(User);
  return repo.save(repo.create({
    name: label, email: `${MAIL}${label}-${rand()}@example.com`,
    passwordHash: await bcrypt.hash(PASSWORD, 4), role,
    campus: 'test', emailVerifiedAt: new Date(),
  }));
}
async function login(email: string, ip: string) {
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: PASSWORD }).expect(201);
  return res.body.accessToken as string;
}
const api = (token: string, ip: string) => ({
  get: (u: string) => request(server()).get(u).set('X-Forwarded-For', ip).set('Authorization', `Bearer ${token}`),
  post: (u: string) => request(server()).post(u).set('X-Forwarded-For', ip).set('Authorization', `Bearer ${token}`),
  patch: (u: string) => request(server()).patch(u).set('X-Forwarded-For', ip).set('Authorization', `Bearer ${token}`),
  del: (u: string) => request(server()).delete(u).set('X-Forwarded-For', ip).set('Authorization', `Bearer ${token}`),
});
const reminderJob = (id: string, kind: string) =>
  (svc as unknown as { queue: { getJob(id: string): Promise<{ opts: { delay?: number } } | undefined> } }).queue.getJob(`reminder-${id}-${kind}`);

let owner: User, borrower: User, admin: User, resourceId: string;
let ownerApi: ReturnType<typeof api>, borrowerApi: ReturnType<typeof api>, adminApi: ReturnType<typeof api>;
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService).useValue(fakeMail).compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init(); // must return promptly even if Redis were slow
  ds = app.get(DataSource);
  svc = app.get(NotificationsService);
  admin = await seedUser('admin', UserRole.ADMIN);
  adminApi = api(await login(admin.email, '203.0.113.63'), '203.0.113.63');

  owner = await seedUser('owner');
  borrower = await seedUser('borrower');
  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const res = await ds.getRepository(Resource).save(ds.getRepository(Resource).create({
    ownerId: owner.id, categoryId: category.id, title: 'Casio fx-991', description: null, isListed: true,
  }));
  resourceId = res.id;
  ownerApi = api(await login(owner.email, '203.0.113.61'), '203.0.113.61');
  borrowerApi = api(await login(borrower.email, '203.0.113.62'), '203.0.113.62');
}, 60_000);

afterAll(async () => {
  try {
    await ds.query(`DELETE le FROM loan_events le JOIN resources r ON r.id = le.resourceId JOIN users u ON u.id = r.ownerId WHERE u.email LIKE '${MAIL}%'`);
    await ds.query(`DELETE br FROM borrow_requests br JOIN resources r ON r.id = br.resourceId JOIN users u ON u.id = r.ownerId WHERE u.email LIKE '${MAIL}%'`);
    await ds.query(`DELETE FROM resources WHERE ownerId IN (SELECT id FROM users WHERE email LIKE '${MAIL}%')`);
    await ds.query(`DELETE FROM users WHERE email LIKE '${MAIL}%'`); // notifications cascade
    await (svc as unknown as { queue?: { obliterate(o: object): Promise<void> } }).queue?.obliterate({ force: true });
  } finally {
    await app?.close();
  }
});

describe('queue health', () => {
  it('reports a connected Redis', async () => {
    const res = await adminApi.get('/notifications/health').expect(200);
    expect(res.body.redis).toBe('connected');
  });
});

describe('borrow lifecycle -> notifications, emails and reminder jobs', () => {
  let requestId: string;

  it('a new request notifies the owner in-app and by email', async () => {
    const dueDate = new Date(Date.now() + 2 * 86_400_000 - 60_000).toISOString();
    const res = await borrowerApi.post('/borrow-requests').send({ resourceId, dueDate }).expect(201);
    requestId = res.body.id;
    await waitFor(async () => (await ownerApi.get('/notifications')).body.items.some((n: { type: string }) => n.type === 'borrow.requested'));
    await waitFor(() => sent.some((m) => m.to === owner.email && m.subject === 'New borrowing request'));
  });

  it('approval notifies the borrower and schedules three reminder jobs', async () => {
    await ownerApi.patch(`/borrow-requests/${requestId}/approve`).expect(200);
    await waitFor(async () => (await borrowerApi.get('/notifications')).body.items.some((n: { type: string }) => n.type === 'borrow.approved'));
    await waitFor(() => sent.some((m) => m.to === borrower.email && m.subject === 'Borrowing request approved'));
    for (const kind of ['due-soon', 'due-now', 'overdue']) {
      const job = await reminderJob(requestId, kind);
      expect(job, kind).toBeDefined();
      expect(job!.opts.delay).toBeGreaterThan(0);
    }
  });

  it('cancelling removes the reminder jobs and tells the owner', async () => {
    await borrowerApi.patch(`/borrow-requests/${requestId}/cancel`).expect(200);
    await waitFor(async () => !(await reminderJob(requestId, 'due-soon')) && !(await reminderJob(requestId, 'overdue')));
    await waitFor(async () => (await ownerApi.get('/notifications')).body.items.some((n: { type: string }) => n.type === 'borrow.cancelled'));
  });
});

describe('inbox API', () => {
  it('unread-count matches the list and read-state filters work', async () => {
    const before = (await ownerApi.get('/notifications/unread-count').expect(200)).body.count as number;
    expect(before).toBeGreaterThanOrEqual(2);
    const items = (await ownerApi.get('/notifications').expect(200)).body.items as { id: string; readAt: string | null }[];
    await ownerApi.patch(`/notifications/${items[0].id}/read`).expect(200);
    expect((await ownerApi.get('/notifications/unread-count')).body.count).toBe(before - 1);

    const unread = (await ownerApi.get('/notifications?unreadOnly=true')).body.items as { readAt: string | null }[];
    expect(unread.every((n) => n.readAt === null)).toBe(true);
    const all = (await ownerApi.get('/notifications?unreadOnly=false')).body.items as unknown[];
    expect(all.length).toBe(items.length); // regression: "false" must not behave like true

    await ownerApi.patch('/notifications/read-all').expect(200);
    expect((await ownerApi.get('/notifications/unread-count')).body.count).toBe(0);
  });

  it('users cannot read or delete each other\'s notifications', async () => {
    const mine = (await borrowerApi.get('/notifications').expect(200)).body.items as { id: string }[];
    expect(mine.length).toBeGreaterThan(0);
    await ownerApi.patch(`/notifications/${mine[0].id}/read`).expect(404);
    await ownerApi.del(`/notifications/${mine[0].id}`).expect(404);
    await borrowerApi.del(`/notifications/${mine[0].id}`).expect(200);
  });

  it('rejects invalid query params', async () => {
    await ownerApi.get('/notifications?limit=500').expect(400);
  });
});
describe('admin-only endpoints', () => {
  it('students get 403 on health and test', async () => {
    await ownerApi.get('/notifications/health').expect(403);
    await ownerApi.post('/notifications/test').expect(403);
  });
  it('admins see a connected Redis', async () => {
    expect((await adminApi.get('/notifications/health').expect(200)).body.redis).toBe('connected');
  });
});