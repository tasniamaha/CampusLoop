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
import { User } from '../src/users/entities/user.entity.js';

// Account and category deactivation over the real HTTP stack and MySQL. Deactivation is set in the
// database here; the admin endpoints that set it are tested in the admin specs.
// Test app has NO global "api" prefix.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `deact-${RUN}`;

let app: INestApplication;
let ds: DataSource;
let ipCounter = 0;
const userIds: string[] = [];
const categoryIds: string[] = [];

type Session = { id: string; email: string; ip: string; accessToken: string; refreshToken: string };

const server = () => app.getHttpServer();
const nextIp = () => `198.51.107.${++ipCounter}`;
const get = (url: string, token: string, ip: string) =>
  request(server()).get(url).set('X-Forwarded-For', ip).set('Authorization', `Bearer ${token}`);
const login = (email: string, password = PASSWORD) =>
  request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });
const setDeactivated = (userId: string, on: boolean) =>
  ds.query('UPDATE users SET deactivatedAt = ? WHERE id = ?', [on ? new Date() : null, userId]);

async function makeUser(label: string): Promise<Session> {
  const email = `deact-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({ name: `deact-${label}`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), campus: CAMPUS, emailVerifiedAt: new Date() }),
  );
  userIds.push(user.id);
  const res = await login(email).expect(201);
  return { id: user.id, email, ip: nextIp(), accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

async function makeCategory(label: string): Promise<string> {
  const id = randomUUID();
  await ds.query('INSERT INTO resource_categories (id, name, slug) VALUES (?, ?, ?)', [id, `Deact ${label} ${RUN}`, `deact-${label}-${RUN}`]);
  categoryIds.push(id);
  return id;
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

describe('deactivated accounts', () => {
  it('a still-valid access token stops working on the next request', async () => {
    const s = await makeUser('token');
    await get('/auth/me', s.accessToken, s.ip).expect(200);
    await setDeactivated(s.id, true);

    const me = await get('/auth/me', s.accessToken, s.ip).expect(401);
    expect(me.body.message).toBe('This account has been deactivated.');
    await get('/notifications', s.accessToken, s.ip).expect(401);
  });

  it('cannot log in; a wrong password still gets the generic message', async () => {
    const s = await makeUser('login');
    await setDeactivated(s.id, true);

    expect((await login(s.email).expect(401)).body.message).toBe('This account has been deactivated.');
    expect((await login(s.email, 'wrong-password-123').expect(401)).body.message).toBe('Invalid email or password');
  });

  it('cannot refresh, even with a refresh token issued before deactivation', async () => {
    const s = await makeUser('refresh');
    await setDeactivated(s.id, true);

    await request(server()).post('/auth/refresh').set('X-Forwarded-For', nextIp()).send({ refreshToken: s.refreshToken }).expect(401);
  });

  it('after reactivation the user can log in and use the new token', async () => {
    const s = await makeUser('reactivate');
    await setDeactivated(s.id, true);
    await login(s.email).expect(401);

    await setDeactivated(s.id, false);
    const res = await login(s.email).expect(201);
    await get('/auth/me', res.body.accessToken, s.ip).expect(200);
  });

  it('a role change in the database applies to the next request with the same token', async () => {
    const s = await makeUser('role');
    await ds.query("UPDATE users SET role = 'admin' WHERE id = ?", [s.id]);
    expect((await get('/auth/me', s.accessToken, s.ip).expect(200)).body.role).toBe('admin');
    await get('/moderation/reports', s.accessToken, s.ip).expect(200); // token still says student

    await ds.query("UPDATE users SET role = 'student' WHERE id = ?", [s.id]);
    await get('/moderation/reports', s.accessToken, s.ip).expect(403);
  });
});

describe('deactivated categories', () => {
  let owner: Session;
  let activeId: string;
  let retiredId: string;
  let resourceId: string;

  const createResource = (categoryId: string) =>
    request(server())
      .post('/resources')
      .set('X-Forwarded-For', owner.ip)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Graphing calculator', categoryId });
  const patchResource = (body: Record<string, unknown>) =>
    request(server())
      .patch(`/resources/${resourceId}`)
      .set('X-Forwarded-For', owner.ip)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(body);

  beforeAll(async () => {
    owner = await makeUser('owner');
    activeId = await makeCategory('active');
    retiredId = await makeCategory('retired');
    resourceId = (await createResource(retiredId).expect(201)).body.id;
    await ds.query('UPDATE resource_categories SET deactivatedAt = ? WHERE id = ?', [new Date(), retiredId]);
  });

  it('is hidden from the public category list, which exposes no deactivation field', async () => {
    const res = await get('/resource-categories', owner.accessToken, owner.ip).expect(200);
    const ids = (res.body as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(retiredId);
    for (const c of res.body as Record<string, unknown>[]) expect(Object.keys(c).sort()).toEqual(['id', 'name', 'slug']);
  });

  it('cannot be chosen for a new resource', async () => {
    const res = await createResource(retiredId).expect(400);
    expect(res.body.message).toBe('This category is no longer available');
    await createResource(activeId).expect(201);
  });

  it('existing resources keep it, and can be edited without changing it', async () => {
    const res = await get(`/resources/${resourceId}`, owner.accessToken, owner.ip).expect(200);
    expect(res.body.category.id).toBe(retiredId);

    await patchResource({ title: 'Graphing calculator (TI-84)' }).expect(200);
    await patchResource({ categoryId: retiredId, title: 'Graphing calculator (TI-84 Plus)' }).expect(200); // unchanged category
  });

  it('a resource can move to an active category but not back to the deactivated one', async () => {
    await patchResource({ categoryId: activeId }).expect(200);
    expect((await patchResource({ categoryId: retiredId }).expect(400)).body.message).toBe('This category is no longer available');
  });
});
