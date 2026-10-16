import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { MailService, type MailMessage } from '../src/mail/mail.service.js';

// Each group of tests uses its own client IP so the per-IP throttlers never interfere.
const IP = { compare: '203.0.113.21', flow: '203.0.113.22', validation: '203.0.113.23', limit: '203.0.113.24' };
const PASSWORD = 'correct-horse-battery';

let app: INestApplication;
const sent: MailMessage[] = [];
const fakeMail = { send: async (m: MailMessage) => void sent.push(m) };

const rand = () => Math.random().toString(36).slice(2, 10);
const server = () => app.getHttpServer();
const resetMails = (to: string) => sent.filter((m) => m.to === to && m.subject.includes('Reset your'));
const tokenFrom = (m: MailMessage) => /reset-password\?token=([\w-]+)/.exec(m.text)![1];

const register = (email: string, ip: string) =>
  request(server()).post('/users/register').set('X-Forwarded-For', ip)
    .send({ name: 'Reset Http', email, password: PASSWORD, campus: 'test' });
const forgot = (email: string, ip: string) =>
  request(server()).post('/auth/forgot-password').set('X-Forwarded-For', ip).send({ email });
const resetPw = (token: string, password: string, ip: string) =>
  request(server()).post('/auth/reset-password').set('X-Forwarded-For', ip).send({ token, password });
const login = (email: string, password: string, ip: string) =>
  request(server()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password });

async function waitFor(predicate: () => boolean, ms = 4_000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for the mail');
    await new Promise((r) => setTimeout(r, 50));
  }
}
const newEmail = () => `reset-http-${rand()}@example.com`;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(fakeMail)
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // main.ts installs this globally; test apps do not get it for free.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
}, 60_000);

afterAll(async () => {
  await app.get(DataSource).query(`DELETE FROM users WHERE email LIKE 'reset-http-%@example.com'`);
  await app?.close();
});

describe('POST /auth/forgot-password', () => {
  it('answers identically for a known and an unknown address', async () => {
    const known = newEmail();
    await register(known, IP.compare).expect(201);
    const a = await forgot(known, IP.compare);
    const b = await forgot(newEmail(), IP.compare);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
  });

  it('mails a reset link only when the account exists', async () => {
    const known = newEmail();
    const unknown = newEmail();
    await register(known, IP.compare).expect(201);
    await forgot(known, IP.compare).expect(202);
    await forgot(unknown, IP.compare).expect(202);
    await waitFor(() => resetMails(known).length === 1);
    await new Promise((r) => setTimeout(r, 500)); // give a wrongly-sent mail time to appear
    expect(resetMails(known)).toHaveLength(1);
    expect(resetMails(unknown)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    await forgot('not-an-email', IP.validation).expect(400);
  });

  it('is rate limited per IP: the 11th request in an hour gets 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await forgot(newEmail(), IP.limit)).status);
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('POST /auth/reset-password', () => {
  it('full flow: forgot, reset, then only the new password logs in', async () => {
    const email = newEmail();
    await register(email, IP.flow).expect(201);
    await forgot(email, IP.flow).expect(202);
    await waitFor(() => resetMails(email).length === 1);
    const token = tokenFrom(resetMails(email)[0]);

    await resetPw(token, 'brand-new-password-1', IP.flow).expect(200).expect({ reset: true }); // no bearer token needed
    await login(email, 'brand-new-password-1', IP.flow).expect(201);
    await login(email, PASSWORD, IP.flow).expect(401);
  });

  it('a too-short password fails validation and does not burn the link', async () => {
    const email = newEmail();
    await register(email, IP.validation).expect(201);
    await forgot(email, IP.validation).expect(202);
    await waitFor(() => resetMails(email).length === 1);
    const token = tokenFrom(resetMails(email)[0]);

    await resetPw(token, 'short', IP.validation).expect(400);
    await resetPw(token, 'brand-new-password-1', IP.validation).expect(200);
  });

  it('gives a generic 400 for a well-formed but unknown token', async () => {
    const res = await resetPw('a'.repeat(43), 'brand-new-password-1', IP.validation).expect(400);
    expect(String(res.body.message)).toMatch(/invalid or has expired/i);
  });

  it('rejects a token shorter than 20 characters as a validation error', async () => {
    await resetPw('short', 'brand-new-password-1', IP.validation).expect(400);
  });
});

describe('known gaps (todo)', () => {
  it.todo('revokes sessions issued before the reset (needs refresh tokens)');
  it.todo('an unverified account does not keep the first registrant\'s password when someone else re-registers it');
  it.todo('sends a "your password was changed" notice to the account email');
});