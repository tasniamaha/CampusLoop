import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

/** One account as the admin rules see it, read under lock inside the transaction. */
export interface AccountState {
  id: string;
  isActiveAdmin: boolean;
}

export type AccountChange = 'demote' | 'promote-or-keep' | 'deactivate' | 'reactivate';

/**
 * The rules every admin user change must pass, checked inside the transaction after the active
 * admins and the target are locked. Pure, so it can be unit-tested without a database.
 *
 * - The actor must still be an active admin (they may have been demoted or deactivated by a
 *   concurrent request after RolesGuard ran).
 * - Admins can't change their own role or deactivate themselves.
 * - The last active admin can never be demoted or deactivated, whoever asks ('system' included).
 *
 * For an HTTP actor the last-admin rule follows from the first two (the actor is another active
 * admin), but it is checked on its own so no path, such as a CLI, can ever reach zero admins.
 */
export function assertAdminChangeAllowed(
  actor: { id: string } | 'system',
  target: AccountState,
  activeAdminIds: readonly string[],
  change: AccountChange,
): void {
  if (actor !== 'system' && !activeAdminIds.includes(actor.id)) {
    throw new ForbiddenException('Insufficient role');
  }
  if (actor !== 'system' && actor.id === target.id && (change === 'demote' || change === 'promote-or-keep' || change === 'deactivate')) {
    throw new BadRequestException(
      change === 'deactivate' ? 'You cannot deactivate your own account' : 'You cannot change your own role',
    );
  }
  const removesAnAdmin = target.isActiveAdmin && (change === 'demote' || change === 'deactivate');
  if (removesAnAdmin && activeAdminIds.filter((id) => id !== target.id).length === 0) {
    throw new ConflictException('The last active admin cannot be demoted or deactivated');
  }
}
