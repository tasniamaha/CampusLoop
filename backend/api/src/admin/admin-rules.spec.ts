import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { assertAdminChangeAllowed } from './admin-rules.js';

const admin = (id: string) => ({ id, isActiveAdmin: true });
const student = (id: string) => ({ id, isActiveAdmin: false });

describe('assertAdminChangeAllowed', () => {
  it('lets an active admin demote or deactivate another admin', () => {
    expect(() => assertAdminChangeAllowed({ id: 'a' }, admin('b'), ['a', 'b'], 'demote')).not.toThrow();
    expect(() => assertAdminChangeAllowed({ id: 'a' }, admin('b'), ['a', 'b'], 'deactivate')).not.toThrow();
    expect(() => assertAdminChangeAllowed({ id: 'a' }, student('s'), ['a'], 'promote-or-keep')).not.toThrow();
  });

  it('refuses an actor who is no longer an active admin (demoted by a concurrent request)', () => {
    expect(() => assertAdminChangeAllowed({ id: 'a' }, admin('b'), ['b'], 'demote')).toThrow(ForbiddenException);
    expect(() => assertAdminChangeAllowed({ id: 'a' }, student('s'), ['b'], 'promote-or-keep')).toThrow(ForbiddenException);
  });

  it('refuses changing your own role or deactivating yourself', () => {
    expect(() => assertAdminChangeAllowed({ id: 'a' }, admin('a'), ['a', 'b'], 'demote')).toThrow('You cannot change your own role');
    expect(() => assertAdminChangeAllowed({ id: 'a' }, admin('a'), ['a', 'b'], 'promote-or-keep')).toThrow(BadRequestException);
    expect(() => assertAdminChangeAllowed({ id: 'a' }, admin('a'), ['a', 'b'], 'deactivate')).toThrow(
      'You cannot deactivate your own account',
    );
  });

  it('never demotes or deactivates the last active admin, even for the system actor', () => {
    expect(() => assertAdminChangeAllowed('system', admin('x'), ['x'], 'demote')).toThrow(ConflictException);
    expect(() => assertAdminChangeAllowed('system', admin('x'), ['x'], 'deactivate')).toThrow(
      'The last active admin cannot be demoted or deactivated',
    );
    expect(() => assertAdminChangeAllowed('system', admin('x'), ['x', 'y'], 'demote')).not.toThrow();
  });

  it('changes to non-admins never count against the admin total', () => {
    expect(() => assertAdminChangeAllowed({ id: 'a' }, student('s'), ['a'], 'demote')).not.toThrow();
    expect(() => assertAdminChangeAllowed({ id: 'a' }, student('s'), ['a'], 'deactivate')).not.toThrow();
    expect(() => assertAdminChangeAllowed('system', student('s'), [], 'promote-or-keep')).not.toThrow();
  });
});
