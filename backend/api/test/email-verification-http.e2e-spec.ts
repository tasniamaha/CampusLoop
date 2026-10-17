import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { MailService, type MailMessage } from '../src/mail/mail.service.js';

// Separate client IPs per group so the per-IP throttlers never interfere with each other.
const IP = { verify: '203.0.113.31', resend: '203.0.113.32', gate: '203.0.113.33' };
const PASSWORD = 'correct-horse-battery';

let app: INestApplication;
const sent: MailMessage[] = [];
const fakeMail = { send: async (m: MailMessage) => void sent.push(m) };

const rand = () => Math.random().toString(36).slice(2, 10);
const server = () => app.getHttpServer();
const newEmail = () => `verify-http-${rand()}@example.com`;
const verifyMails = (to: string) => sent.filter((m) => m.to === to && m.subject.includes('Confirm your'));
const tokenFrom = (m: MailMessage) => /verify-email\?token=([\w-]+)/.exec(m.text)![1];

const register = (email: string, ip: string) =>
  request(server()).post('/users/register').set('X-Forwarded-For', ip)
    .send({ name: 'Verify Http', email, password: PASSWORD, campus: 'test' });
const login = (email: string, ip: string) =>
  request(server()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: PASSWORD });
const verify = (token: string, ip: string) =>
  request(server()).post('/auth/verify-email').set('X-Forwarded-For', ip).send({ token });

async function waitFor(predicate: () => boolean, ms = 4_000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for the mail');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Registers a fresh UNVERIFIED user and returns its address, bearer token and first verification token. */
async function newUnverifiedUser(ip: string) {
  const email = newEmail();
  await register(email, ip).expect(201);
  await waitFor(() => verifyMails(email).length === 1);
  const bearer = (await login(email, ip).expect(201)).body.accessToken as string;
  return { email, bearer, token: tokenFrom(verifyMails(email)[0]) };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(fakeMail)
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
}, 60_000);

afterAll(async () => {
  await app.get(DataSource).query(`DELETE FROM users WHERE email LIKE 'verify-http-%@example.com'`);
  await app?.close();
});

describe('POST /auth/verify-email', () => {
  it('rejects a well-formed but unknown token with a generic 400', async () => {
    const res = await verify('a'.repeat(43), IP.verify).expect(400);
    expect(String(res.body.message)).toMatch(/invalid or has expired/i);
  });

  it('rejects a token shorter than 20 characters as a validation error', async () => {
    await verify('short', IP.verify).expect(400);
  });

  it('accepts a valid token once (200) and rejects the repeat (400)', async () => {
    const { token } = await newUnverifiedUser(IP.verify);
    await verify(token, IP.verify).expect(200).expect({ verified: true });
    await verify(token, IP.verify).expect(400);
  });

  it('needs no bearer token (the user is not logged in when they click the link)', async () => {
    const { token } = await newUnverifiedUser(IP.verify);
    await request(server()).post('/auth/verify-email').set('X-Forwarded-For', IP.verify).send({ token }).expect(200);
  });
});

describe('POST /auth/resend-verification', () => {
  it('returns 401 without a bearer token', async () => {
    await request(server()).post('/auth/resend-verification').set('X-Forwarded-For', IP.resend).expect(401);
  });

  it('returns 202, sends a new link, and the old link stops working', async () => {
    const { email, bearer, token: oldToken } = await newUnverifiedUser(IP.resend);
    await request(server()).post('/auth/resend-verification').set('X-Forwarded-For', IP.resend)
      .set('Authorization', `Bearer ${bearer}`).expect(202);
    await waitFor(() => verifyMails(email).length === 2);
    await verify(oldToken, IP.resend).expect(400);
    await verify(tokenFrom(verifyMails(email)[1]), IP.resend).expect(200);
  });

  it('is rate limited per user: the 4th request in an hour gets 429', async () => {
    const { bearer } = await newUnverifiedUser(IP.resend);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await request(server()).post('/auth/resend-verification').set('X-Forwarded-For', IP.resend)
          .set('Authorization', `Bearer ${bearer}`)).status,
      );
    }
    expect(statuses.slice(0, 3)).toEqual([202, 202, 202]);
    expect(statuses[3]).toBe(429);
  });
});

describe('verified-email gate on a write route (POST /resources)', () => {
  it('is 401 without a bearer token', async () => {
    await request(server()).post('/resources').set('X-Forwarded-For', IP.gate).send({}).expect(401);
  });

  it('is 403 before verification', async () => {
    const { bearer } = await newUnverifiedUser(IP.gate);
    const res = await request(server()).post('/resources').set('X-Forwarded-For', IP.gate)
      .set('Authorization', `Bearer ${bearer}`).send({}).expect(403);
    expect(String(res.body.message)).toMatch(/verify your email/i);
  });

  it('passes the gate after verification, using the SAME bearer token issued before', async () => {
    const { bearer, token } = await newUnverifiedUser(IP.gate);
    await verify(token, IP.gate).expect(200);
    // Empty body: if the gate let us through we hit DTO validation (400), not the gate (403).
    // This avoids depending on a seeded category id.
    await request(server()).post('/resources').set('X-Forwarded-For', IP.gate)
      .set('Authorization', `Bearer ${bearer}`).send({}).expect(400);
  });

  it('reports emailVerifiedAt on /auth/me only after verification', async () => {
    const { bearer, token } = await newUnverifiedUser(IP.gate);
    const me = () => request(server()).get('/auth/me').set('X-Forwarded-For', IP.gate)
      .set('Authorization', `Bearer ${bearer}`).expect(200);
    expect((await me()).body.emailVerifiedAt).toBeNull();
    await verify(token, IP.gate).expect(200);
    expect((await me()).body.emailVerifiedAt).not.toBeNull();
  });
});