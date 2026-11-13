import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { MailService, type MailMessage } from '../src/mail/mail.service.js';
import { RefreshRevokeReason, RefreshToken } from '../src/auth/entities/refresh-token.entity.js';
import { REFRESH_REUSE_GRACE_MS } from '../src/auth/refresh-token.service.js';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { VerificationToken, VerificationType } from '../src/verification/entities/verification-token.entity.js';
import { PasswordResetService } from '../src/verification/password-reset.service.js';
import { AuditLog } from '../src/audit/entities/audit-log.entity.js';
import { newOpaqueToken, sha256 } from '../src/verification/token.util.js';

const PASSWORD = 'correct-horse-battery';
const EMAIL_PREFIX = 'refresh-http-';

let app: INestApplication;
let ds: DataSource;
let ipCounter = 0;
// Fresh documentation-range IP per call so the login throttlers never interfere.
const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;
const rand = () => Math.random().toString(36).slice(2, 10);
const server = () => app.getHttpServer();

interface Session {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: { id: string; role: string };
}

const refreshCall = (refreshToken: string) =>
  request(server()).post('/auth/refresh').set('X-Forwarded-For', nextIp()).send({ refreshToken });

async function newSession(): Promise<Session> {
  const email = `${EMAIL_PREFIX}${rand()}@example.com`;
  const ip = nextIp();
  await request(server()).post('/users/register').set('X-Forwarded-For', ip)
    .send({ name: 'Refresh Http', email, password: PASSWORD, campus: 'test' }).expect(201);
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', ip)
    .send({ email, password: PASSWORD }).expect(201);
  return res.body as Session;
}

const rowOf = (raw: string) => ds.getRepository(RefreshToken).findOneByOrFail({ tokenHash: sha256(raw) });
const jwtRole = (jwt: string) =>
  (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as { role: string }).role;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({ send: async (_m: MailMessage) => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  ds = app.get(DataSource);
}, 60_000);

afterAll(async () => {
  await ds?.query(`DELETE FROM users WHERE email LIKE '${EMAIL_PREFIX}%@example.com'`); // tokens cascade
  await app?.close();
});

describe('POST /auth/login', () => {
  it('issues an opaque refresh token and stores only its hash', async () => {
    const s = await newSession();
    expect(s.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(s.refreshExpiresAt).getTime()).toBeGreaterThan(Date.now());
    const row = await rowOf(s.refreshToken);
    expect(row.tokenHash).not.toContain(s.refreshToken);
    expect(row.userId).toBe(s.user.id);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates: returns a new working pair and marks the old token rotated', async () => {
    const s = await newSession();
    const res = await refreshCall(s.refreshToken).expect(200);
    expect(res.body.refreshToken).not.toBe(s.refreshToken);
    expect((await rowOf(s.refreshToken)).rotatedAt).not.toBeNull();
    expect((await rowOf(res.body.refreshToken)).familyId).toBe((await rowOf(s.refreshToken)).familyId);
    await request(server()).get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  });

  it('treats parallel refreshes with one token as a race, not theft', async () => {
    const s = await newSession();
    const results = await Promise.all(Array.from({ length: 5 }, () => refreshCall(s.refreshToken)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const fresh = new Set(results.map((r) => r.body.refreshToken as string));
    expect(fresh.size).toBe(5);
    const family = (await rowOf(s.refreshToken)).familyId;
    const revoked = await ds.getRepository(RefreshToken).countBy({ familyId: family, revokeReason: RefreshRevokeReason.REUSE_DETECTED });
    expect(revoked).toBe(0);
  });

  // Reproduces the 2026-11-13 reuse incident: three parallel rotations of one token (as when the
  // proxy renews a session for a page, its prefetches and notification polling at once), then the
  // browser never stores any of the three answers and sends the parent again much later.
  it('3 concurrent refreshes fork the family; replaying the parent after the grace window revokes all of it', async () => {
    const s = await newSession();
    const parent = await rowOf(s.refreshToken);

    const results = await Promise.all([1, 2, 3].map(() => refreshCall(s.refreshToken)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const children = results.map((r) => r.body as Session);
    expect(new Set(children.map((c) => c.refreshToken)).size).toBe(3);

    // The parent is rotated once; each child is a separate, live token in the same family.
    const afterRace = await rowOf(s.refreshToken);
    expect(afterRace.rotatedAt).not.toBeNull();
    for (const child of children) {
      const row = await rowOf(child.refreshToken);
      expect(row.familyId).toBe(parent.familyId);
      expect(row.rotatedAt).toBeNull();
      expect(row.revokedAt).toBeNull();
      await request(server()).get('/auth/me').set('Authorization', `Bearer ${child.accessToken}`).expect(200);
    }
    expect(await ds.getRepository(RefreshToken).countBy({ familyId: parent.familyId })).toBe(4);
    expect(await ds.getRepository(AuditLog).countBy({ action: 'auth.refresh_reuse_detected', targetId: s.user.id })).toBe(0);

    // Within the grace window the parent still works and forks a fourth child.
    await refreshCall(s.refreshToken).expect(200);

    // Later (simulated by moving rotatedAt back), the parent comes back: the whole family is revoked.
    await ds.getRepository(RefreshToken).update({ id: parent.id }, { rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000) });
    await refreshCall(s.refreshToken).expect(401);
    for (const child of children) {
      expect((await rowOf(child.refreshToken)).revokeReason).toBe(RefreshRevokeReason.REUSE_DETECTED);
      await refreshCall(child.refreshToken).expect(401);
    }
    expect(await ds.getRepository(AuditLog).countBy({ action: 'auth.refresh_reuse_detected', targetId: s.user.id })).toBe(1);
  });

  it('revokes the whole family when a rotated token is replayed after the grace window', async () => {
    const s = await newSession();
    const child = (await refreshCall(s.refreshToken).expect(200)).body as Session;
    await ds.getRepository(RefreshToken).update(
      { tokenHash: sha256(s.refreshToken) },
      { rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000) },
    );

    await refreshCall(s.refreshToken).expect(401);
    // The legitimate holder of the child is also logged out: we cannot tell thief from owner.
    await refreshCall(child.refreshToken).expect(401);
    expect((await rowOf(child.refreshToken)).revokeReason).toBe(RefreshRevokeReason.REUSE_DETECTED);

    const audit = await ds.getRepository(AuditLog).findOneBy({ action: 'auth.refresh_reuse_detected', targetId: s.user.id });
    expect(audit).not.toBeNull();
  });

  it('rejects an expired token', async () => {
    const s = await newSession();
    await ds.getRepository(RefreshToken).update({ tokenHash: sha256(s.refreshToken) }, { expiresAt: new Date(Date.now() - 1_000) });
    await refreshCall(s.refreshToken).expect(401);
  });

  it('never extends a session past its absolute family cap', async () => {
    const s = await newSession();
    const cap = new Date(Date.now() + 60_000);
    await ds.getRepository(RefreshToken).update({ tokenHash: sha256(s.refreshToken) }, { familyExpiresAt: cap });
    const child = (await refreshCall(s.refreshToken).expect(200)).body as Session;
    expect(new Date(child.refreshExpiresAt).getTime()).toBeLessThanOrEqual(cap.getTime());
  });

  it('rejects unknown and malformed tokens', async () => {
    await refreshCall(newOpaqueToken()).expect(401);
    await refreshCall('short').expect(400);
    await request(server()).post('/auth/refresh').send({}).expect(400);
  });

  it('re-reads the role, so promotions apply without logging in again', async () => {
    const s = await newSession();
    expect(jwtRole(s.accessToken)).toBe(UserRole.STUDENT);
    await ds.getRepository(User).update({ id: s.user.id }, { role: UserRole.MODERATOR });
    const res = await refreshCall(s.refreshToken).expect(200);
    expect(jwtRole(res.body.accessToken)).toBe(UserRole.MODERATOR);
  });
});

describe('logout', () => {
  it('POST /auth/logout ends only that session', async () => {
    const a = await newSession();
    const b = (await request(server()).post('/auth/login').set('X-Forwarded-For', nextIp())
      .send({ email: (await ds.getRepository(User).findOneByOrFail({ id: a.user.id })).email, password: PASSWORD })
      .expect(201)).body as Session;

    await request(server()).post('/auth/logout').send({ refreshToken: a.refreshToken }).expect(204);
    await refreshCall(a.refreshToken).expect(401);
    await refreshCall(b.refreshToken).expect(200);
  });

  it('POST /auth/logout is silent for unknown tokens', async () => {
    await request(server()).post('/auth/logout').send({ refreshToken: newOpaqueToken() }).expect(204);
  });

  it('POST /auth/logout-all needs an access token and ends every session', async () => {
    const s = await newSession();
    await request(server()).post('/auth/logout-all').expect(401);
    await request(server()).post('/auth/logout-all').set('Authorization', `Bearer ${s.accessToken}`).expect(204);
    await refreshCall(s.refreshToken).expect(401);
  });
});

describe('password reset', () => {
  it('revokes every refresh token of the user', async () => {
    const s = await newSession();
    const raw = newOpaqueToken();
    await ds.getRepository(VerificationToken).insert({
      userId: s.user.id,
      type: VerificationType.PASSWORD_RESET,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + 3_600_000),
      usedAt: null,
      createdAt: new Date(),
    });
    await app.get(PasswordResetService).reset(raw, 'brand-new-password-1');

    await refreshCall(s.refreshToken).expect(401);
    expect((await rowOf(s.refreshToken)).revokeReason).toBe(RefreshRevokeReason.PASSWORD_RESET);
  });
});
