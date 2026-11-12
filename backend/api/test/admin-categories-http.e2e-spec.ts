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

// /admin/categories over the real HTTP stack and MySQL: access, create (slug, duplicates), rename
// (slug kept), deactivate/reactivate, resource counts, audit rows, and no delete endpoint.
// Test app has NO global "api" prefix.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `cat-${RUN}`;

let app: INestApplication;
let ds: DataSource;
let ipCounter = 0;
const userIds: string[] = [];

type Actor = { id: string; ip: string; token: string };
type Category = { id: string; name: string; slug: string; deactivatedAt: string | null; createdAt: string; resourceCount: number };

const server = () => app.getHttpServer();
const nextIp = () => `198.51.109.${(++ipCounter % 250) + 1}`;
const call = (method: 'get' | 'post' | 'patch' | 'delete', url: string, who?: Actor) => {
  const req = request(server())[method](url).set('X-Forwarded-For', who?.ip ?? nextIp());
  return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
};
/** Unique per run, so reruns and other specs never collide on the unique name/slug indexes. */
const named = (label: string) => `Cat ${label} ${RUN}`;

async function makeUser(label: string, role: UserRole = UserRole.STUDENT): Promise<Actor> {
  const email = `cat-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({ name: `cat-${label}`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), campus: CAMPUS, role, emailVerifiedAt: new Date() }),
  );
  userIds.push(user.id);
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password: PASSWORD }).expect(201);
  return { id: user.id, ip: nextIp(), token: res.body.accessToken };
}

const auditRows = (targetId: string) =>
  ds.query('SELECT actorId, action, metadata FROM audit_logs WHERE targetId = ? ORDER BY createdAt', [targetId]) as Promise<
    Array<{ actorId: string; action: string; metadata: unknown }>
  >;
const meta = (m: unknown) => (typeof m === 'string' ? JSON.parse(m) : m);
const publicIds = async (who: Actor) => ((await call('get', '/resource-categories', who).expect(200)).body as { id: string }[]).map((c) => c.id);

let admin: Actor;

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
  admin = await makeUser('admin', UserRole.ADMIN);
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await ds.query(`DELETE FROM resources WHERE ownerId IN (${marks})`, userIds);
      await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, userIds);
      await ds.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await ds.query('DELETE FROM resource_categories WHERE name LIKE ?', [`% ${RUN}`]);
  }
  await app?.close();
});

describe('access', () => {
  it('not logged in: 401; students and moderators: 403 on every route, with no change', async () => {
    const id = randomUUID();
    const routes = [
      () => call('get', '/admin/categories'),
      () => call('post', '/admin/categories').send({ name: named('nope') }),
      () => call('patch', `/admin/categories/${id}`).send({ name: named('nope') }),
      () => call('patch', `/admin/categories/${id}/deactivate`),
      () => call('patch', `/admin/categories/${id}/reactivate`),
    ];
    for (const route of routes) await route().expect(401);

    for (const who of [await makeUser('student'), await makeUser('mod', UserRole.MODERATOR)]) {
      await call('get', '/admin/categories', who).expect(403);
      await call('post', '/admin/categories', who).send({ name: named('nope') }).expect(403);
      await call('patch', `/admin/categories/${id}`, who).send({ name: named('nope') }).expect(403);
      await call('patch', `/admin/categories/${id}/deactivate`, who).expect(403);
      await call('patch', `/admin/categories/${id}/reactivate`, who).expect(403);
    }
    expect(Number((await ds.query('SELECT COUNT(*) AS n FROM resource_categories WHERE name = ?', [named('nope')]))[0].n)).toBe(0);
  });
});

describe('POST /admin/categories', () => {
  it('creates an active category with a slug from the name, and audits it', async () => {
    const res = await call('post', '/admin/categories', admin).send({ name: `  Lab   Kits ${RUN} ` }).expect(201);
    const created = res.body as Category;
    expect(created).toMatchObject({ name: `Lab Kits ${RUN}`, slug: `lab-kits-${RUN}`, deactivatedAt: null, resourceCount: 0 });
    expect(Object.keys(created).sort()).toEqual(['createdAt', 'deactivatedAt', 'id', 'name', 'resourceCount', 'slug']);
    expect(await publicIds(admin)).toContain(created.id);

    const rows = await auditRows(created.id);
    expect(rows.map((r) => [r.action, r.actorId])).toEqual([['category.created', admin.id]]);
    expect(meta(rows[0].metadata)).toEqual({ name: `Lab Kits ${RUN}`, slug: `lab-kits-${RUN}` });
  });

  it('refuses duplicates: same name in another case, or a name with the same slug (409)', async () => {
    await call('post', '/admin/categories', admin).send({ name: named('dupe') }).expect(201);
    expect((await call('post', '/admin/categories', admin).send({ name: named('DUPE') }).expect(409)).body.message).toBe(
      'A category with this name already exists',
    );
    await call('post', '/admin/categories', admin).send({ name: `Cat-dupe-${RUN}` }).expect(409); // same slug
  });

  it('two concurrent creates of the same name: exactly one wins', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => call('post', '/admin/categories', admin).send({ name: named('race') })));
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409, 409]);
    expect(Number((await ds.query('SELECT COUNT(*) AS n FROM resource_categories WHERE name = ?', [named('race')]))[0].n)).toBe(1);
  });

  it('rejects invalid names with 400 and writes nothing', async () => {
    for (const body of [{}, { name: 'x' }, { name: 'x'.repeat(61) }, { name: 42 }, { name: named('extra'), slug: 'mine' }]) {
      await call('post', '/admin/categories', admin).send(body).expect(400);
    }
    expect((await call('post', '/admin/categories', admin).send({ name: '!! ??' }).expect(400)).body.message).toBe(
      'The name must contain letters or digits',
    );
  });
});

describe('rename, deactivate, reactivate, list', () => {
  let category: Category;
  let owner: Actor;

  beforeAll(async () => {
    category = (await call('post', '/admin/categories', admin).send({ name: named('calculators') }).expect(201)).body;
    owner = await makeUser('owner');
    await call('post', '/resources', owner).send({ title: 'Scientific calculator', categoryId: category.id }).expect(201);
    await call('post', '/resources', owner).send({ title: 'Graphing calculator', categoryId: category.id }).expect(201);
  });

  it('lists every category, deactivated included, with resource counts', async () => {
    const list = (await call('get', '/admin/categories', admin).expect(200)).body as Category[];
    const mine = list.find((c) => c.id === category.id)!;
    expect(mine.resourceCount).toBe(2);
    const names = list.map((c) => c.name);
    expect(names).toEqual(names.toSorted((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  });

  it('rename keeps the slug and is audited with from/to', async () => {
    const res = await call('patch', `/admin/categories/${category.id}`, admin).send({ name: named('Calculators & Graphing') }).expect(200);
    expect(res.body).toMatchObject({ id: category.id, name: named('Calculators & Graphing'), slug: category.slug });

    const rows = await auditRows(category.id);
    expect(rows.at(-1)!.action).toBe('category.renamed');
    expect(meta(rows.at(-1)!.metadata)).toEqual({ from: named('calculators'), to: named('Calculators & Graphing'), slug: category.slug });
  });

  it('rename refuses a taken name (409), the same name (409), unknown (404) and malformed ids (400), auditing nothing', async () => {
    const other = (await call('post', '/admin/categories', admin).send({ name: named('other') }).expect(201)).body as Category;
    const before = (await auditRows(category.id)).length;
    await call('patch', `/admin/categories/${category.id}`, admin).send({ name: other.name }).expect(409);
    await call('patch', `/admin/categories/${category.id}`, admin).send({ name: named('Calculators & Graphing') }).expect(409);
    await call('patch', `/admin/categories/${randomUUID()}`, admin).send({ name: named('ghost') }).expect(404);
    await call('patch', '/admin/categories/not-a-uuid', admin).send({ name: named('ghost') }).expect(400);
    expect((await auditRows(category.id)).length).toBe(before);
  });

  it('deactivate hides it publicly but keeps it on existing resources; reactivate brings it back', async () => {
    const off = await call('patch', `/admin/categories/${category.id}/deactivate`, admin).expect(200);
    expect(off.body.deactivatedAt).not.toBeNull();
    await call('patch', `/admin/categories/${category.id}/deactivate`, admin).expect(409);
    expect(await publicIds(owner)).not.toContain(category.id);
    await call('post', '/resources', owner).send({ title: 'Another calculator', categoryId: category.id }).expect(400);

    const adminList = (await call('get', '/admin/categories', admin).expect(200)).body as Category[];
    expect(adminList.find((c) => c.id === category.id)).toMatchObject({ resourceCount: 2 });

    const on = await call('patch', `/admin/categories/${category.id}/reactivate`, admin).expect(200);
    expect(on.body.deactivatedAt).toBeNull();
    await call('patch', `/admin/categories/${category.id}/reactivate`, admin).expect(409);
    expect(await publicIds(owner)).toContain(category.id);

    expect((await auditRows(category.id)).map((r) => r.action).slice(-2)).toEqual(['category.deactivated', 'category.reactivated']);
  });

  it('has no delete endpoint', async () => {
    await call('delete', `/admin/categories/${category.id}`, admin).expect(404);
    expect(Number((await ds.query('SELECT COUNT(*) AS n FROM resource_categories WHERE id = ?', [category.id]))[0].n)).toBe(1);
  });
});
