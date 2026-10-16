import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerifiedEmailGuard } from './verified-email.guard.js';
import { RequireVerifiedEmail } from '../require-verified-email.decorator.js';
import type { UsersService } from '../../users/users.service.js';

class Sample {
  @RequireVerifiedEmail() gated() {}
  open() {}
}

function setup(user: unknown, reqUser: { sub: string } | undefined) {
  const findById = vi.fn().mockResolvedValue(user);
  const guard = new VerifiedEmailGuard(new Reflector(), { findById } as unknown as UsersService);
  const ctx = (method: 'gated' | 'open') =>
    ({
      getHandler: () => Sample.prototype[method],
      getClass: () => Sample,
      switchToHttp: () => ({ getRequest: () => ({ user: reqUser }) }),
    }) as unknown as ExecutionContext;
  return { guard, ctx, findById };
}

describe('VerifiedEmailGuard', () => {
  it('ignores undecorated routes without touching the DB', async () => {
    const { guard, ctx, findById } = setup(null, { sub: 'u1' });
    await expect(guard.canActivate(ctx('open'))).resolves.toBe(true);
    expect(findById).not.toHaveBeenCalled();
  });

  it('allows a verified user', async () => {
    const { guard, ctx } = setup({ emailVerifiedAt: new Date() }, { sub: 'u1' });
    await expect(guard.canActivate(ctx('gated'))).resolves.toBe(true);
  });

  it('blocks an unverified user with 403', async () => {
    const { guard, ctx } = setup({ emailVerifiedAt: null }, { sub: 'u1' });
    await expect(guard.canActivate(ctx('gated'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when there is no authenticated user', async () => {
    const { guard, ctx } = setup(null, undefined);
    await expect(guard.canActivate(ctx('gated'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the user row no longer exists', async () => {
    const { guard, ctx } = setup(null, { sub: 'ghost' });
    await expect(guard.canActivate(ctx('gated'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});