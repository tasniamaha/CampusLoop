import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { NotificationsController } from './notifications.controller.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';

describe('NotificationsController role gates', () => {
  it.each(['health', 'test'] as const)('%s is admin-only', (name) => {
    const fn = NotificationsController.prototype[name] as unknown as object;
    expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual([UserRole.ADMIN]);
  });
});