import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetPasswordDto } from './reset-password.dto.js';
import { ForgotPasswordDto } from './forgot-password.dto.js';

// Same options as the global ValidationPipe in main.ts.
const errorProps = async <T extends object>(cls: new () => T, plain: object) =>
  (await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

const token43 = 'a'.repeat(43);
const pw12 = 'p'.repeat(12);

describe('ResetPasswordDto', () => {
  it('accepts a normal request', async () => {
    expect(await errorProps(ResetPasswordDto, { token: token43, password: pw12 })).toEqual([]);
  });

  it.each([
    [19, true],
    [20, false],
    [200, false],
    [201, true],
  ])('token length %i -> rejected: %s', async (len, rejected) => {
    const errs = await errorProps(ResetPasswordDto, { token: 'a'.repeat(len), password: pw12 });
    expect(errs.includes('token')).toBe(rejected);
  });

  it.each([
    [11, true],
    [12, false],
    [72, false],
    [73, true],
  ])('password length %i -> rejected: %s', async (len, rejected) => {
    const errs = await errorProps(ResetPasswordDto, { token: token43, password: 'p'.repeat(len) });
    expect(errs.includes('password')).toBe(rejected);
  });

  it('rejects missing fields', async () => {
    expect(await errorProps(ResetPasswordDto, {})).toEqual(expect.arrayContaining(['token', 'password']));
  });

  it('rejects non-string values', async () => {
    expect(await errorProps(ResetPasswordDto, { token: 12345678901234567890, password: 123456789012 })).toEqual(
      expect.arrayContaining(['token', 'password']),
    );
  });

  it('rejects unknown properties such as role', async () => {
    expect(await errorProps(ResetPasswordDto, { token: token43, password: pw12, role: 'admin' })).toContain('role');
  });
});

describe('ForgotPasswordDto', () => {
  it('accepts a valid email', async () => {
    expect(await errorProps(ForgotPasswordDto, { email: 'a@example.com' })).toEqual([]);
  });

  it.each(['', 'not-an-email', 'a@', '@b.com'])('rejects %j', async (email) => {
    expect(await errorProps(ForgotPasswordDto, { email })).toContain('email');
  });

  it('rejects an email longer than 254 characters', async () => {
    expect(await errorProps(ForgotPasswordDto, { email: `${'a'.repeat(250)}@example.com` })).toContain('email');
  });

  it('rejects a missing email and unknown properties', async () => {
    expect(await errorProps(ForgotPasswordDto, {})).toContain('email');
    expect(await errorProps(ForgotPasswordDto, { email: 'a@example.com', admin: true })).toContain('admin');
  });
});