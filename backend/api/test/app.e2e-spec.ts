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