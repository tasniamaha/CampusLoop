import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { UsersService } from '../../users/users.service.js';

const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '5m' } });
type AuthState = { id: string; role: string; deactivatedAt: Date | null } | null;
const users = { findAuthState: vi.fn<(id: string) => Promise<AuthState>>() };
users.findAuthState.mockImplementation(async (id) => ({ id, role: 'student', deactivatedAt: null }));
const guard = new JwtAuthGuard(jwt, new Reflector(), users as unknown as UsersService);

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

  it('takes the role from the database, not from the token', async () => {
    users.findAuthState.mockResolvedValueOnce({ id: 'user-2', role: 'student', deactivatedAt: null });
    const token = await jwt.signAsync({ sub: 'user-2', role: 'admin' });
    const { context, req } = ctx(`Bearer ${token}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req as { user?: unknown }).user).toEqual({ sub: 'user-2', role: 'student', roleFromDb: true });
  });

  it('rejects a deactivated account with a still-valid token', async () => {
    users.findAuthState.mockResolvedValueOnce({ id: 'user-3', role: 'admin', deactivatedAt: new Date() });
    const token = await jwt.signAsync({ sub: 'user-3', role: 'admin' });
    await expect(guard.canActivate(ctx(`Bearer ${token}`).context)).rejects.toThrow('This account has been deactivated.');
  });

  it('rejects a token for a user that no longer exists', async () => {
    users.findAuthState.mockResolvedValueOnce(null);
    const token = await jwt.signAsync({ sub: 'gone', role: 'student' });
    await expect(guard.canActivate(ctx(`Bearer ${token}`).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not touch the database for an invalid token', async () => {
    users.findAuthState.mockClear();
    await expect(guard.canActivate(ctx('Bearer not-a-jwt').context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.findAuthState).not.toHaveBeenCalled();
  });
});
