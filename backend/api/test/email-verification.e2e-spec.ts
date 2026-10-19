import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { VerificationToken } from '../src/verification/entities/verification-token.entity.js';
import { EmailVerificationService } from '../src/verification/email-verification.service.js';
import type { MailService, MailMessage } from '../src/mail/mail.service.js';
import { CreateUsers1791838335819 } from '../src/database/migrations/1791838335819-CreateUsers.js';
import { CreateResourcesAndBorrowRequests1791900000000 } from '../src/database/migrations/1791900000000-CreateResourcesAndBorrowRequests.js';
import { ResourceMarketplace1792000000000 } from '../src/database/migrations/1792000000000-ResourceMarketplace.js';
import { CreateLoanEvents1792100000000 } from '../src/database/migrations/1792100000000-CreateLoanEvents.js';
import { CreateVerificationTokens1792200000000 } from '../src/database/migrations/1792200000000-CreateVerificationTokens.js';
import { AddEmailCanonical1792700000000 } from '../src/database/migrations/1792700000000-AddEmailCanonical.js';
import { CreateNotifications1792800000000 } from '../src/database/migrations/1792800000000-CreateNotifications.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';

let ds: DataSource;
let sent: MailMessage[] = [];
let service: EmailVerificationService;
const createdUserIds: string[] = [];

const fakeMail = { send: async (m: MailMessage) => void sent.push(m) } as unknown as MailService;
const tokenFrom = (m: MailMessage) => /token=([\w-]+)/.exec(m.text)![1];

async function newUser() {
  const repo = ds.getRepository(User);
  const u = await repo.save(
    repo.create({
      name: 'Verify Test',
      email: `verify-${Math.random().toString(36).slice(2, 10)}@example.com`,
      passwordHash: 'x',
      role: UserRole.STUDENT,
      campus: 'test',
      emailVerifiedAt: null,
    }),
  );
  createdUserIds.push(u.id);
  return u;
}

beforeAll(async () => {
  ds = new DataSource({
    type: 'mariadb',
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT ?? 3317),
    username: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? 'root',
    database: process.env.TEST_DB_NAME ?? 'campusloop_test',
    entities: [User, VerificationToken, Notification],
    migrations: [AddEmailCanonical1792700000000,
      CreateUsers1791838335819,
      CreateResourcesAndBorrowRequests1791900000000,
      ResourceMarketplace1792000000000,
      CreateLoanEvents1792100000000,
      CreateVerificationTokens1792200000000,
      CreateNotifications1792800000000,
    ],
  });
  await ds.initialize();
  await ds.runMigrations(); // no-op when the CI/CLI step already applied them
  service = new EmailVerificationService(ds, fakeMail, new ConfigService({ WEB_URL: 'http://web.test' }));
}, 60_000);

afterAll(async () => {
  if (createdUserIds.length) await ds.getRepository(User).delete(createdUserIds); // tokens cascade
  await ds?.destroy();
});

describe('email verification', () => {
  it('stores only a hash and sends a working link', async () => {
    sent = [];
    const u = await newUser();
    expect(await service.sendFor(u)).toBe(true);
    const raw = tokenFrom(sent[0]);
    const rows = await ds.getRepository(VerificationToken).find({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(raw);
    await service.consume(raw);
    expect((await ds.getRepository(User).findOneByOrFail({ id: u.id })).emailVerifiedAt).not.toBeNull();
  });

  it('a link works exactly once', async () => {
    sent = [];
    const u = await newUser();
    await service.sendFor(u);
    const raw = tokenFrom(sent[0]);
    await service.consume(raw);
    await expect(service.consume(raw)).rejects.toThrow();
  });

  it('rejects expired links', async () => {
    sent = [];
    const u = await newUser();
    await service.sendFor(u);
    await ds.query('UPDATE verification_tokens SET expiresAt = ? WHERE userId = ?', [
      new Date(Date.now() - 60_000),
      u.id,
    ]);
    await expect(service.consume(tokenFrom(sent[0]))).rejects.toThrow();
  });

  it('a newer link retires the older one', async () => {
    sent = [];
    const u = await newUser();
    await service.sendFor(u);
    await service.sendFor(u);
    await expect(service.consume(tokenFrom(sent[0]))).rejects.toThrow();
    await expect(service.consume(tokenFrom(sent[1]))).resolves.toBeUndefined();
  });

  it('caps sends per user per hour', async () => {
    sent = [];
    const u = await newUser();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await service.sendFor(u));
    expect(results).toEqual([true, true, true, false, false]);
    expect(sent).toHaveLength(3);
  });

  it('two simultaneous clicks: one wins', async () => {
    sent = [];
    const u = await newUser();
    await service.sendFor(u);
    const raw = tokenFrom(sent[0]);
    const results = await Promise.allSettled([service.consume(raw), service.consume(raw)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
    it('a failed send neither burns quota nor kills the previous link', async () => {
    const failing = new EmailVerificationService(
      ds,
      { send: async () => { throw new Error('smtp down'); } } as unknown as MailService,
      new ConfigService({ WEB_URL: 'http://web.test' }),
    );
    sent = [];
    const u = await newUser();
    expect(await service.sendFor(u)).toBe(true);
    const good = tokenFrom(sent[0]);
    for (let i = 0; i < 5; i++) expect(await failing.sendFor(u)).toBe(false);
    expect(await ds.getRepository(VerificationToken).count({ where: { userId: u.id } })).toBe(1);
    await expect(service.consume(good)).resolves.toBeUndefined();
  });
});