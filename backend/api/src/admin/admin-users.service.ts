import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { RefreshRevokeReason } from '../auth/entities/refresh-token.entity.js';
import { User, UserRole } from '../users/entities/user.entity.js';
import { assertAdminChangeAllowed, type AccountChange } from './admin-rules.js';
import type { ListUsersQuery } from './dto/admin-users.dto.js';

/** What an admin sees about a user. No password hash, no canonical email, no tokens. */
const ADMIN_USER_FIELDS = ['id', 'name', 'email', 'campus', 'role', 'emailVerifiedAt', 'deactivatedAt', 'createdAt'] as const;
export type AdminUserView = Pick<User, (typeof ADMIN_USER_FIELDS)[number]>;

const toView = (user: User): AdminUserView => ({
  id: user.id,
  name: user.name,
  email: user.email,
  campus: user.campus,
  role: user.role,
  emailVerifiedAt: user.emailVerifiedAt,
  deactivatedAt: user.deactivatedAt,
  createdAt: user.createdAt,
});

/** Escapes LIKE wildcards so a search for "50%" matches the text, not everything. */
const likeContains = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

export type Actor = { id: string; ip: string | null };

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async list(query: ListUsersQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .select(ADMIN_USER_FIELDS.map((field) => `u.${field}`));

    if (query.q) qb.andWhere('(u.name LIKE :q OR u.email LIKE :q)', { q: likeContains(query.q) });
    if (query.campus) qb.andWhere('u.campus = :campus', { campus: query.campus });
    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.verified) qb.andWhere(query.verified === 'true' ? 'u.emailVerifiedAt IS NOT NULL' : 'u.emailVerifiedAt IS NULL');
    if (query.status) qb.andWhere(query.status === 'active' ? 'u.deactivatedAt IS NULL' : 'u.deactivatedAt IS NOT NULL');

    const [rows, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data: rows.map(toView), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  changeRole(actor: Actor, targetId: string, role: UserRole) {
    const change: AccountChange = role === UserRole.ADMIN ? 'promote-or-keep' : 'demote';
    return this.mutate(actor, targetId, change, async (m, target) => {
      if (target.role === role) throw new ConflictException(`This user already has the ${role} role`);
      const from = target.role;
      await m.update(User, { id: target.id }, { role });
      await this.audit.record(m, {
        actorId: actor.id,
        action: 'user.role_changed',
        targetType: 'user',
        targetId: target.id,
        metadata: { from, to: role },
        ipAddress: actor.ip,
      });
    });
  }

  deactivate(actor: Actor, targetId: string) {
    return this.mutate(actor, targetId, 'deactivate', async (m, target) => {
      if (target.deactivatedAt) throw new ConflictException('This user is already deactivated');
      await m.update(User, { id: target.id }, { deactivatedAt: new Date() });
      // Same transaction: if the audit row or the revocation fails, the user stays active.
      await this.refreshTokens.revokeAllForUser(target.id, RefreshRevokeReason.DEACTIVATED, m);
      await this.audit.record(m, {
        actorId: actor.id,
        action: 'user.deactivated',
        targetType: 'user',
        targetId: target.id,
        metadata: { role: target.role },
        ipAddress: actor.ip,
      });
    });
  }

  reactivate(actor: Actor, targetId: string) {
    return this.mutate(actor, targetId, 'reactivate', async (m, target) => {
      if (!target.deactivatedAt) throw new ConflictException('This user is not deactivated');
      await m.update(User, { id: target.id }, { deactivatedAt: null });
      await this.audit.record(m, {
        actorId: actor.id,
        action: 'user.reactivated',
        targetType: 'user',
        targetId: target.id,
        metadata: { role: target.role },
        ipAddress: actor.ip,
      });
    });
  }

  /**
   * One transaction per change: lock every active admin (fixed id order, so concurrent changes
   * serialise without deadlocks), then the target; re-check the actor and the last-admin rule
   * against the locked rows; apply the change and its audit row together.
   *
   * READ COMMITTED: each locking read sees rows committed by the transaction it waited for (so the
   * second of two admins demoting each other sees it is no longer an admin), and no gap locks are
   * taken on the users index, so sign-ups are never blocked by an admin change.
   */
  private async mutate(
    actor: Actor,
    targetId: string,
    change: AccountChange,
    apply: (m: EntityManager, target: User) => Promise<void>,
  ): Promise<AdminUserView> {
    return this.dataSource.transaction('READ COMMITTED', async (m) => {
      const admins: Array<{ id: string }> = await m.query(
        'SELECT id FROM users WHERE role = ? AND deactivatedAt IS NULL ORDER BY id FOR UPDATE',
        [UserRole.ADMIN],
      );
      const target = await m.findOne(User, { where: { id: targetId }, lock: { mode: 'pessimistic_write' } });
      if (!target) throw new NotFoundException('User not found');

      const activeAdminIds = admins.map((row) => row.id);
      assertAdminChangeAllowed(
        { id: actor.id },
        { id: target.id, isActiveAdmin: target.role === UserRole.ADMIN && !target.deactivatedAt },
        activeAdminIds,
        change,
      );

      await apply(m, target);
      const updated = await m.findOneOrFail(User, { where: { id: target.id } });
      return toView(updated);
    });
  }
}
