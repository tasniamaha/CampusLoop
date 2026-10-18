import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '5m' } });
const guard = new JwtAuthGuard(jwt, new Reflector());

function ctx(authorization: string) {
  const req = { headers: { authorization } };
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('JwtAuthGuard', () => {
  it('accepts a normal session token', async () => {
    const token = await jwt.signAsync({ sub: 'user-1', role: 'student' });
    const { context, req } = ctx(`Bearer ${token}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req as { user?: { sub: string } }).user?.sub).toBe('user-1');
  });

  it('rejects a QR token signed with the same key', async () => {
    const qr = await jwt.signAsync({ purpose: 'pickup', requestId: 'r1', ownerId: 'o1' }, { expiresIn: '5m' });
    await expect(guard.canActivate(ctx(`Bearer ${qr}`).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects any validly signed token that has no subject', async () => {
    const t = await jwt.signAsync({ role: 'admin' });
    await expect(guard.canActivate(ctx(`Bearer ${t}`).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});