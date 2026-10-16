import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('GET / without a token is rejected by the global JWT guard', async () => {
    await request(app.getHttpServer()).get('/').expect(401);
  });

  it('GET /resources without a token is rejected', async () => {
    await request(app.getHttpServer()).get('/resources').expect(401);
  });

  it('GET /borrow-requests without a token is rejected', async () => {
    await request(app.getHttpServer()).get('/borrow-requests?role=incoming').expect(401);
  });
});
describe('Login throttling (e2e)', () => {
  let app: INestApplication;
  const uniq = () => Math.random().toString(36).slice(2, 10);
  const login = (email: string, password: string, ip: string, extra: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .set(extra)
      .send({ email, password });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', true); // mirror main.ts
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('blocks the 6th attempt from the same IP for the same email', async () => {
    const email = `same-${uniq()}@example.com`;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await login(email, 'wrong-password-123', '203.0.113.10')).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('cannot be bypassed by sending a different junk bearer token on each request', async () => {
    const email = `junk-${uniq()}@example.com`;
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push(
        (await login(email, 'wrong-password-123', '203.0.113.11', { Authorization: `Bearer junk-${i}` })).status,
      );
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(5);
  });

  it('an attacker burning a victim email from one IP does not lock the victim out from another IP', async () => {
    const email = `victim-${uniq()}@example.com`;
    const password = 'correct-horse-battery';
    await request(app.getHttpServer())
      .post('/users/register')
      .send({ name: 'Victim', email, password, campus: 'test' })
      .expect(201);

    for (let i = 0; i < 8; i++) await login(email, 'wrong-password-123', '203.0.113.12'); // attacker
    expect((await login(email, 'wrong-password-123', '203.0.113.12')).status).toBe(429);

    const victim = await login(email, password, '198.51.100.20'); // real user, different IP
    expect(victim.status).toBe(201);
    expect(victim.body.accessToken).toBeTruthy();
  });

  it('caps one IP spraying many different emails', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await login(`spray-${uniq()}@example.com`, 'wrong-password-123', '203.0.113.13')).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
  });

  it('does not apply the login limits to other endpoints', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app.getHttpServer()).get('/resources').set('X-Forwarded-For', '203.0.113.14');
      expect(res.status).toBe(401); // unauthenticated, but never 429
    }
  });
});
describe('Default throttle bucket (e2e)', () => {
  let app: INestApplication;
  const uniq = () => Math.random().toString(36).slice(2, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', true); // mirror main.ts
    await app.init();
  }, 60_000);
  afterAll(async () => {
    await app?.close();
  });

  async function signUp(loginIp: string) {
    const email = `bucket-${uniq()}@example.com`;
    const password = 'correct-horse-battery';
    await request(app.getHttpServer())
      .post('/users/register')
      .send({ name: 'Bucket Test', email, password, campus: 'test' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', loginIp)
      .send({ email, password })
      .expect(201);
    return res.body.accessToken as string;
  }

  const hit = (token: string, ip: string) =>
    request(app.getHttpServer())
      .get('/resource-categories')
      .set('X-Forwarded-For', ip)
      .set('Authorization', `Bearer ${token}`);

  it('two users behind the same IP do not share a bucket', async () => {
    const a = await signUp('198.51.100.50');
    const b = await signUp('198.51.100.51');
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) {
      statuses.push((await hit(a, '203.0.113.50')).status);
      statuses.push((await hit(b, '203.0.113.50')).status);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
  }, 60_000);

  it('a single user is still capped at 120 requests per minute', async () => {
    const token = await signUp('198.51.100.52');
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) statuses.push((await hit(token, '203.0.113.51')).status);
    expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(120).every((s) => s === 429)).toBe(true);
  }, 60_000);
});