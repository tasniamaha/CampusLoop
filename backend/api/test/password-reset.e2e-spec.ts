import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity.js';
import { VerificationToken, VerificationType } from '../src/verification/entities/verification-token.entity.js';
import { PasswordResetService } from '../src/verification/password-reset.service.js';
import { EmailVerificationService } from '../src/verification/email-verification.service.js';
import { sha256 } from '../src/verification/token.util.js';
import type { MailMessage, MailService } from '../src/mail/mail.service.js';
import { cleanupUsers, createTestDataSource, passwordHashOf, rand, seedUser } from './helpers/test-db.js';

let ds: DataSource;
let sent: MailMessage[] = [];
let reset: PasswordResetService;
let verification: EmailVerificationService;

const fakeMail = { send: async (m: MailMessage) => void sent.push(m) } as unknown as MailService;
const resetMails = () => sent.filter((m) => m.subject.includes('Reset your'));
const resetToken = (i = resetMails().length - 1) => /reset-password\?token=([\w-]+)/.exec(resetMails()[i].text)![1];
const verifyToken = (m: MailMessage) => /verify-email\?token=([\w-]+)/.exec(m.text)![1];
const matches = async (plain: string, userId: string) => bcrypt.compare(plain, (await passwordHashOf(ds, userId)).passwordHash);

beforeAll(async () => {
  ds = await createTestDataSource();
  const config = new ConfigService({ WEB_URL: 'http://web.test' });
  reset = new PasswordResetService(ds, fakeMail, config);
  verification = new EmailVerificationService(ds, fakeMail, config);
}, 60_000);

beforeEach(() => {
  sent = [];
});

afterAll(async () => {
  await cleanupUsers(ds);
  await ds?.destroy();
});

describe('requesting a reset', () => {
  it('sends nothing for an unknown email', async () => {
    await reset.requestReset(`nobody-${rand()}@example.com`);
    expect(sent).toHaveLength(0);
  });

  it('normalises case and surrounding whitespace in the address', async () => {
    const { user } = await seedUser(ds);
    await reset.requestReset(`  ${user.email.toUpperCase()}  `);
    expect(resetMails()).toHaveLength(1);
    expect(resetMails()[0].to).toBe(user.email);
  });

  it('mails a link and stores only a hash that expires in one hour', async () => {
    const { user } = await seedUser(ds);
    await reset.requestReset(user.email);
    const raw = resetToken();
    const rows = await ds.getRepository(VerificationToken).find({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(VerificationType.PASSWORD_RESET);
    expect(rows[0].tokenHash).toBe(sha256(raw));
    expect(rows[0].tokenHash).not.toBe(raw);
    expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBe(60 * 60 * 1000);
  });

  it('a newer link retires the older one', async () => {
    const { user } = await seedUser(ds);
    await reset.requestReset(user.email);
    await reset.requestReset(user.email);
    await expect(reset.reset(resetToken(0), 'valid-new-password-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(reset.reset(resetToken(1), 'valid-new-password-1')).resolves.toBeUndefined();
  });

  it('caps requests at 3 per hour and stays silent afterwards', async () => {
    const { user } = await seedUser(ds);
    for (let i = 0; i < 5; i++) await reset.requestReset(user.email);
    expect(resetMails()).toHaveLength(3);
  });

  it('verification mails do not count against the reset cap', async () => {
    const { user } = await seedUser(ds);
    for (let i = 0; i < 3; i++) await verification.sendFor(user);
    for (let i = 0; i < 3; i++) await reset.requestReset(user.email);
    expect(resetMails()).toHaveLength(3);
  });
});

describe('resetting', () => {
  it('sets the new password: the new one works and the old one does not', async () => {
    const { user, password } = await seedUser(ds);
    await reset.requestReset(user.email);
    await reset.reset(resetToken(), 'brand-new-password-1');
    expect(await matches('brand-new-password-1', user.id)).toBe(true);
    expect(await matches(password, user.id)).toBe(false);
    const row = await ds.getRepository(VerificationToken).findOneByOrFail({ userId: user.id });
    expect(row.usedAt).not.toBeNull();
  });

  it('a link works exactly once and a replay cannot overwrite the password', async () => {
    const { user } = await seedUser(ds);
    await reset.requestReset(user.email);
    const token = resetToken();
    await reset.reset(token, 'first-new-password-1');
    await expect(reset.reset(token, 'second-new-password-2')).rejects.toBeInstanceOf(BadRequestException);
    expect(await matches('first-new-password-1', user.id)).toBe(true);
    expect(await matches('second-new-password-2', user.id)).toBe(false);
  });

  it('rejects an expired link and leaves the password alone', async () => {
    const { user, password } = await seedUser(ds);
    await reset.requestReset(user.email);
    await ds.query('UPDATE verification_tokens SET expiresAt = ? WHERE userId = ?', [
      new Date(Date.now() - 1_000),
      user.id,
    ]);
    await expect(reset.reset(resetToken(), 'brand-new-password-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(await matches(password, user.id)).toBe(true);
  });

  it('rejects an unknown token', async () => {
    await expect(reset.reset('x'.repeat(43), 'brand-new-password-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a password over 72 bytes without burning the link', async () => {
    const { user } = await seedUser(ds);
    await reset.requestReset(user.email);
    const token = resetToken();
    const tooLong = 'é'.repeat(40); // 40 characters passes the DTO, but it is 80 bytes
    await expect(reset.reset(token, tooLong)).rejects.toBeInstanceOf(BadRequestException);
    await expect(reset.reset(token, 'valid-new-password-1')).resolves.toBeUndefined(); // still usable
  });

  it('verifies an unverified email, because the link proved inbox ownership', async () => {
    const { user } = await seedUser(ds, { verifiedAt: null });
    await reset.requestReset(user.email);
    await reset.reset(resetToken(), 'brand-new-password-1');
    expect((await ds.getRepository(User).findOneByOrFail({ id: user.id })).emailVerifiedAt).not.toBeNull();
  });

  it('does not change the verification time of an already verified account', async () => {
    const verifiedAt = new Date('2026-01-01T00:00:00Z');
    const { user } = await seedUser(ds, { verifiedAt });
    await reset.requestReset(user.email);
    await reset.reset(resetToken(), 'brand-new-password-1');
    const after = await ds.getRepository(User).findOneByOrFail({ id: user.id });
    expect(after.emailVerifiedAt?.getTime()).toBe(verifiedAt.getTime());
  });

  it('two simultaneous resets: exactly one wins and its password is the one stored', async () => {
    const { user } = await seedUser(ds);
    await reset.requestReset(user.email);
    const token = resetToken();
    const passwords = ['password-from-first-1', 'password-from-second-2'];
    const results = await Promise.allSettled(passwords.map((p) => reset.reset(token, p)));
    const winners = results.flatMap((r, i) => (r.status === 'fulfilled' ? [i] : []));
    expect(winners).toHaveLength(1);
    expect(await matches(passwords[winners[0]], user.id)).toBe(true);
    expect(await matches(passwords[1 - winners[0]], user.id)).toBe(false);
  });
});

describe('token types are not interchangeable', () => {
  it('an email-verification token cannot reset a password', async () => {
    const { user, password } = await seedUser(ds);
    await verification.sendFor(user);
    const verifyMail = sent.find((m) => m.subject.includes('Confirm your'))!;
    await expect(reset.reset(verifyToken(verifyMail), 'brand-new-password-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await matches(password, user.id)).toBe(true);
  });

  it('a reset token cannot verify an email', async () => {
    const { user } = await seedUser(ds, { verifiedAt: null });
    await reset.requestReset(user.email);
    await expect(verification.consume(resetToken())).rejects.toBeInstanceOf(BadRequestException);
    expect((await ds.getRepository(User).findOneByOrFail({ id: user.id })).emailVerifiedAt).toBeNull();
  });
});