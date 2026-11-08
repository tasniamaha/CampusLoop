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

// /admin/users over the real HTTP stack and MySQL: access, listing, role changes, deactivation,
// audit rows, self-protection and the last-admin lock under concurrency.
// Test app has NO global "api" prefix.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `adm-${RUN}`;
const ROUNDS = 5;

let app: INestApplication;
let ds: DataSource;
let ipCounter = 0;
const userIds: string[] = [];

type Actor = { id: string; email: string; ip: string; token: string; refreshToken: string };
type View = Record<string, unknown> & { id: string; role: string; deactivatedAt: string | null };

const server = () => app.getHttpServer();
const nextIp = () => `198.51.108.${(++ipCounter % 250) + 1}`;
const call = (method: 'get' | 'patch', url: string, who?: Actor) => {
  const req = request(server())[method](url).set('X-Forwarded-For', who?.ip ?? nextIp());
  return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
};

async function makeUser(label: string, role: UserRole = UserRole.STUDENT, verified = true): Promise<Actor> {
  const email = `adm-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({ name: `adm-${label}`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), campus: CAMPUS, role, emailVerifiedAt: verified ? new Date() : null }),
  );
  userIds.push(user.id);
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password: PASSWORD }).expect(201);
  return { id: user.id, email, ip: nextIp(), token: res.body.accessToken, refreshToken: res.body.refreshToken };
}

const auditRows = (targetId: string) =>
  ds.query('SELECT actorId, action, metadata, ipAddress FROM audit_logs WHERE targetId = ? ORDER BY createdAt', [targetId]) as Promise<
    Array<{ actorId: string; action: string; metadata: Record<string, unknown> | string; ipAddress: string | null }>
  >;
const meta = (m: Record<string, unknown> | string) => (typeof m === 'string' ? JSON.parse(m) : m);
const roleOf = async (id: string) => ((await ds.query('SELECT role FROM users WHERE id = ?', [id])) as Array<{ role: string }>)[0].role;

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
  if (ds?.isInitialized && userIds.length) {
    const marks = userIds.map(() => '?').join(',');
    await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, userIds);
    await ds.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    // audit_logs is append-only (DB triggers); its rows stay, as in the other audit specs.
  }
  await app?.close();
});

describe('access', () => {
  let student: Actor;
  let moderator: Actor;
  let target: Actor;

  beforeAll(async () => {
    student = await makeUser('acc-student');
    moderator = await makeUser('acc-mod', UserRole.MODERATOR);
    target = await makeUser('acc-target');
  });

  it('not logged in: 401 on every admin user route', async () => {
    await call('get', '/admin/users').expect(401);
    await call('patch', `/admin/users/${target.id}/role`).send({ role: 'admin' }).expect(401);
    await call('patch', `/admin/users/${target.id}/deactivate`).expect(401);
    await call('patch', `/admin/users/${target.id}/reactivate`).expect(401);
  });

  it('students and moderators get 403 on every admin user route, and nothing changes', async () => {
    for (const who of [student, moderator]) {
      await call('get', '/admin/users', who).expect(403);
      await call('patch', `/admin/users/${target.id}/role`, who).send({ role: 'admin' }).expect(403);
      await call('patch', `/admin/users/${target.id}/deactivate`, who).expect(403);
      await call('patch', `/admin/users/${target.id}/reactivate`, who).expect(403);
    }
    expect(await roleOf(target.id)).toBe('student');
    expect(await auditRows(target.id)).toEqual([]);
  });
});

describe('GET /admin/users', () => {
  let admin: Actor;
  const list = async (query: string) =>
    (await call('get', `/admin/users?campus=${CAMPUS}&limit=50&${query}`, admin).expect(200)).body as {
      data: View[];
      pagination: { total: number; pages: number };
    };

  beforeAll(async () => {
    admin = await makeUser('list-admin', UserRole.ADMIN);
    await makeUser('list-unverified', UserRole.STUDENT, false);
    const gone = await makeUser('list-gone');
    await ds.query('UPDATE users SET deactivatedAt = ? WHERE id = ?', [new Date(), gone.id]);
    await makeUser('list-percent%');
  });

  it('returns only the admin fields: no password hash, canonical email or tokens', async () => {
    const { data } = await list('');
    expect(data.length).toBeGreaterThan(0);
    for (const user of data) {
      expect(Object.keys(user).sort()).toEqual(['campus', 'createdAt', 'deactivatedAt', 'email', 'emailVerifiedAt', 'id', 'name', 'role']);
    }
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|emailCanonical|token|\$2[aby]\$/);
  });

  it('filters by search text, role, verified and status', async () => {
    expect((await list('q=list-admin')).data.map((u) => u.email)).toEqual([`adm-list-admin-${RUN}@example.com`]);
    expect((await list('role=admin')).data.every((u) => u.role === 'admin')).toBe(true);
    expect((await list('verified=false')).data.map((u) => u.email)).toEqual([`adm-list-unverified-${RUN}@example.com`]);
    expect((await list('status=deactivated')).data.map((u) => u.email)).toEqual([`adm-list-gone-${RUN}@example.com`]);
    expect((await list('status=active')).data.some((u) => u.deactivatedAt !== null)).toBe(false);
  });

  it('treats % and _ in the search as text, not wildcards', async () => {
    expect((await list(`q=${encodeURIComponent('percent%')}`)).data.map((u) => u.email)).toEqual([`adm-list-percent%-${RUN}@example.com`]);
    expect((await list(`q=${encodeURIComponent('%')}`)).data).toHaveLength(1);
  });

  it('paginates, newest first', async () => {
    const page1 = (await call('get', `/admin/users?campus=${CAMPUS}&limit=2&page=1`, admin).expect(200)).body;
    const page2 = (await call('get', `/admin/users?campus=${CAMPUS}&limit=2&page=2`, admin).expect(200)).body;
    expect(page1.data).toHaveLength(2);
    expect(page1.pagination.pages).toBe(Math.ceil(page1.pagination.total / 2));
    expect(page2.data.map((u: View) => u.id)).not.toContain(page1.data[0].id);
  });

  it('rejects invalid filters with 400', async () => {
    await call('get', '/admin/users?role=superuser', admin).expect(400);
    await call('get', '/admin/users?verified=yes', admin).expect(400);
    await call('get', '/admin/users?limit=500', admin).expect(400);
  });
});

describe('PATCH /admin/users/:id/role', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await makeUser('role-admin', UserRole.ADMIN);
  });

  it('changes the role and audits it in the same transaction, with from/to and the IP', async () => {
    const target = await makeUser('role-target');
    const res = await call('patch', `/admin/users/${target.id}/role`, admin).send({ role: 'moderator' }).expect(200);
    expect(res.body).toMatchObject({ id: target.id, role: 'moderator' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|emailCanonical/);

    const rows = await auditRows(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: admin.id, action: 'user.role_changed', ipAddress: admin.ip });
    expect(meta(rows[0].metadata)).toEqual({ from: 'student', to: 'moderator' });
  });

  it('a failed change (same role, bad role, unknown or malformed id) writes no audit row', async () => {
    const target = await makeUser('role-noop');
    await call('patch', `/admin/users/${target.id}/role`, admin).send({ role: 'student' }).expect(409);
    await call('patch', `/admin/users/${target.id}/role`, admin).send({ role: 'superuser' }).expect(400);
    await call('patch', `/admin/users/${target.id}/role`, admin).send({}).expect(400);
    await call('patch', `/admin/users/${randomUUID()}/role`, admin).send({ role: 'admin' }).expect(404);
    await call('patch', '/admin/users/not-a-uuid/role', admin).send({ role: 'admin' }).expect(400);
    expect(await auditRows(target.id)).toEqual([]);
  });

  it('an admin cannot change their own role', async () => {
    const res = await call('patch', `/admin/users/${admin.id}/role`, admin).send({ role: 'student' }).expect(400);
    expect(res.body.message).toBe('You cannot change your own role');
    expect(await roleOf(admin.id)).toBe('admin');
    expect(await auditRows(admin.id)).toEqual([]);
  });

  it('a demoted admin loses admin access on the very next request, with the same token', async () => {
    const other = await makeUser('role-demoted', UserRole.ADMIN);
    await call('get', '/admin/users', other).expect(200);

    await call('patch', `/admin/users/${other.id}/role`, admin).send({ role: 'student' }).expect(200);
    await call('get', '/admin/users', other).expect(403);
    await call('get', '/auth/me', other).expect(200); // still signed in as a student
  });
});

describe('deactivate / reactivate', () => {
  let admin: Actor;

  beforeAll(async () => {
    admin = await makeUser('deact-admin', UserRole.ADMIN);
  });

  it('deactivation ends every session at once and is audited', async () => {
    const target = await makeUser('deact-target');
    const second = await request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: target.email, password: PASSWORD }).expect(201);
    await call('get', '/auth/me', target).expect(200);

    const res = await call('patch', `/admin/users/${target.id}/deactivate`, admin).expect(200);
    expect(res.body.deactivatedAt).not.toBeNull();

    await call('get', '/auth/me', target).expect(401);
    for (const refreshToken of [target.refreshToken, second.body.refreshToken]) {
      await request(server()).post('/auth/refresh').set('X-Forwarded-For', nextIp()).send({ refreshToken }).expect(401);
    }
    const tokens = (await ds.query('SELECT revokeReason FROM refresh_tokens WHERE userId = ? AND rotatedAt IS NULL', [target.id])) as Array<{
      revokeReason: string | null;
    }>;
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens.every((t) => t.revokeReason === 'deactivated')).toBe(true);

    const rows = await auditRows(target.id);
    expect(rows.map((r) => [r.action, r.actorId])).toEqual([['user.deactivated', admin.id]]);
  });

  it('cannot deactivate twice, or deactivate yourself', async () => {
    const target = await makeUser('deact-twice');
    await call('patch', `/admin/users/${target.id}/deactivate`, admin).expect(200);
    await call('patch', `/admin/users/${target.id}/deactivate`, admin).expect(409);

    const self = await call('patch', `/admin/users/${admin.id}/deactivate`, admin).expect(400);
    expect(self.body.message).toBe('You cannot deactivate your own account');
    await call('get', '/auth/me', admin).expect(200);
    expect(await auditRows(admin.id)).toEqual([]);
  });

  it('reactivation lets the user log in again and is audited; reactivating an active user is 409', async () => {
    const target = await makeUser('deact-back');
    await call('patch', `/admin/users/${target.id}/reactivate`, admin).expect(409);
    await call('patch', `/admin/users/${target.id}/deactivate`, admin).expect(200);
    await request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: target.email, password: PASSWORD }).expect(401);

    const res = await call('patch', `/admin/users/${target.id}/reactivate`, admin).expect(200);
    expect(res.body.deactivatedAt).toBeNull();
    await request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: target.email, password: PASSWORD }).expect(201);
    expect((await auditRows(target.id)).map((r) => r.action)).toEqual(['user.deactivated', 'user.reactivated']);
  });
});

describe('last-admin protection under concurrency', () => {
  const activeAdminCount = async () =>
    Number(((await ds.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND deactivatedAt IS NULL")) as Array<{ n: string }>)[0].n);

  it(`two admins demoting each other at the same moment: exactly one wins (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const a = await makeUser(`race-a${round}`, UserRole.ADMIN);
      const b = await makeUser(`race-b${round}`, UserRole.ADMIN);

      const [ab, ba] = await Promise.all([
        call('patch', `/admin/users/${b.id}/role`, a).send({ role: 'student' }),
        call('patch', `/admin/users/${a.id}/role`, b).send({ role: 'student' }),
      ]);
      expect([ab.status, ba.status].sort((x, y) => x - y)).toEqual([200, 403]);
      const roles = [await roleOf(a.id), await roleOf(b.id)].sort((x, y) => x.localeCompare(y));
      expect(roles).toEqual(['admin', 'student']);
      expect((await auditRows(a.id)).length + (await auditRows(b.id)).length).toBe(1); // only the winner's change
    }
  });

  it(`two admins deactivating each other at the same moment: exactly one wins (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const a = await makeUser(`dace-a${round}`, UserRole.ADMIN);
      const b = await makeUser(`dace-b${round}`, UserRole.ADMIN);

      const results = await Promise.all([
        call('patch', `/admin/users/${b.id}/deactivate`, a),
        call('patch', `/admin/users/${a.id}/deactivate`, b),
      ]);
      // The loser is either refused under the lock (403) or, if the winner's commit landed before
      // its request was authenticated, rejected by JwtAuthGuard as deactivated (401).
      const statuses = results.map((r) => r.status).sort((x, y) => x - y);
      expect(statuses[0]).toBe(200);
      expect([401, 403]).toContain(statuses[1]);
      const active = (await ds.query('SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?) AND deactivatedAt IS NULL', [a.id, b.id])) as Array<{
        n: string;
      }>;
      expect(Number(active[0].n)).toBe(1);
    }
  });

  it('a ring of three admins demoting each other never leaves the ring without an admin', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const ring = [await makeUser(`ring-a${round}`, UserRole.ADMIN), await makeUser(`ring-b${round}`, UserRole.ADMIN), await makeUser(`ring-c${round}`, UserRole.ADMIN)];
      const results = await Promise.all(ring.map((actor, i) => call('patch', `/admin/users/${ring[(i + 1) % 3].id}/role`, actor).send({ role: 'student' })));
      const wins = results.filter((r) => r.status === 200).length;
      expect(results.every((r) => r.status === 200 || r.status === 403)).toBe(true);

      const admins = (await Promise.all(ring.map((u) => roleOf(u.id)))).filter((r) => r === 'admin').length;
      expect(admins).toBeGreaterThanOrEqual(1);
      expect(admins).toBe(3 - wins);
    }
    expect(await activeAdminCount()).toBeGreaterThan(0);
  });
});
