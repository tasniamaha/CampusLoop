import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, Logger } from '@nestjs/common';
import { AuthService } from './auth.service.js';

const GENERIC = /reset link is on its way/;

function build(passwordReset: Record<string, unknown> = {}) {
  const pr = {
    requestReset: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    ...passwordReset,
  };
  // constructor order: users, jwt, emailVerification, passwordReset
  const service = new AuthService({} as never, {} as never, {} as never, pr as never);
  return { service, pr };
}

afterEach(() => vi.restoreAllMocks());

describe('AuthService.forgotPassword', () => {
  it('returns the generic message and forwards the address', async () => {
    const { service, pr } = build();
    const res = await service.forgotPassword('a@example.com');
    expect(res.message).toMatch(GENERIC);
    expect(pr.requestReset).toHaveBeenCalledWith('a@example.com');
  });

  it('does not wait for the mail work, so response time cannot reveal the account', async () => {
    const { service } = build({ requestReset: vi.fn(() => new Promise(() => {})) }); // never settles
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('forgotPassword blocked')), 300));
    await expect(Promise.race([service.forgotPassword('a@example.com'), timeout])).resolves.toMatchObject({
      message: expect.stringMatching(GENERIC),
    });
  });

  it('gives the same answer when the underlying request fails, and logs instead of throwing', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const ok = build();
    const failing = build({ requestReset: vi.fn().mockRejectedValue(new Error('smtp down')) });
    const a = await ok.service.forgotPassword('a@example.com');
    const b = await failing.service.forgotPassword('a@example.com');
    await new Promise((r) => setTimeout(r, 20)); // let the detached rejection handler run
    expect(b).toEqual(a);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('smtp down'));
  });
});

describe('AuthService.resetPassword', () => {
  it('delegates and reports success', async () => {
    const { service, pr } = build();
    await expect(service.resetPassword('tok', 'new-password-123')).resolves.toEqual({ reset: true });
    expect(pr.reset).toHaveBeenCalledWith('tok', 'new-password-123');
  });

  it('propagates a rejected token as a 400', async () => {
    const { service } = build({ reset: vi.fn().mockRejectedValue(new BadRequestException('invalid')) });
    await expect(service.resetPassword('tok', 'new-password-123')).rejects.toBeInstanceOf(BadRequestException);
  });
});