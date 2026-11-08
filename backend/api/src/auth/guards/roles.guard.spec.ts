import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/entities/user.entity.js';
import { UsersService } from '../../users/users.service.js';
import { RolesGuard } from './roles.guard.js';

function setup(
  requiredRoles: UserRole[],
  user?: { id: string; role: UserRole; deactivatedAt?: Date | null },
  requestUser: { sub: string; role: string; roleFromDb?: true } = { sub: 'user-1', role: UserRole.ADMIN },
) {
  const request: { user?: { sub: string; role: string; roleFromDb?: true } } = {
    user: requestUser,
  };

  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(requiredRoles),
  };

  const users = {
    findAuthState: vi.fn().mockResolvedValue(user ? { deactivatedAt: null, ...user } : null),
  };

  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return {
    guard: new RolesGuard(
      reflector as unknown as Reflector,
      users as unknown as UsersService,
    ),
    users,
    request,
    context,
  };
}

describe('RolesGuard', () => {
  it('allows routes without role requirements', async () => {
    const { guard, users, context } = setup([]);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(users.findAuthState).not.toHaveBeenCalled();
  });

  it('allows an admin on an admin-only route', async () => {
    const { guard, request, context } = setup(
      [UserRole.ADMIN],
      { id: 'user-1', role: UserRole.ADMIN },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user?.role).toBe(UserRole.ADMIN);
  });

  it('rejects a student on an admin-only route', async () => {
    const { guard, context } = setup(
      [UserRole.ADMIN],
      { id: 'user-1', role: UserRole.STUDENT },
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a deleted user with an existing token', async () => {
    const { guard, context } = setup([UserRole.ADMIN]);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('does not trust a stale admin role in the token', async () => {
    const { guard, request, context } = setup(
      [UserRole.ADMIN],
      { id: 'user-1', role: UserRole.STUDENT },
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(request.user?.role).toBe(UserRole.STUDENT);
  });

  it('reuses the role JwtAuthGuard loaded from the database (no second read)', async () => {
    const { guard, users, context } = setup([UserRole.ADMIN], undefined, { sub: 'user-1', role: UserRole.ADMIN, roleFromDb: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(users.findAuthState).not.toHaveBeenCalled();
  });

  it('rejects a database-loaded student role on an admin route without reading again', async () => {
    const { guard, users, context } = setup([UserRole.ADMIN], undefined, { sub: 'user-1', role: UserRole.STUDENT, roleFromDb: true });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.findAuthState).not.toHaveBeenCalled();
  });

  it('rejects a deactivated user when it has to read the user itself', async () => {
    const { guard, context } = setup([UserRole.ADMIN], { id: 'user-1', role: UserRole.ADMIN, deactivatedAt: new Date() });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
