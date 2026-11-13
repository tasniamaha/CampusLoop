import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { RefreshRevokeReason } from '../auth/entities/refresh-token.entity.js';
import { User, UserRole } from '../users/entities/user.entity.js';
import { canonicalEmail } from '../common/email.js';
import { assertAdminChangeAllowed, type AccountChange } from './admin-rules.js';
import type { ListUsersQuery, UserFilters } from './dto/admin-users.dto.js';

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
/** Command-line changes (npm run admin:promote). Audited with actorId null, the system actor. */
export const SYSTEM_ACTOR = 'system' as const;

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
    const [rows, total] = await this.filtered(query)
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data: rows.map(toView), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  /** Every user matching the filters, newest first (admin fields only). Used by the CSV export. */
  async findAll(filters: UserFilters, limit: number): Promise<{ rows: AdminUserView[]; total: number }> {
    const qb = this.filtered(filters);
    const total = await qb.getCount();
    if (total > limit) return { rows: [], total };
    return { rows: (await qb.getMany()).map(toView), total };
  }

  /** The admin user listing query: admin fields only, filters applied, newest first. */
  private filtered(filters: UserFilters) {
    const qb = this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .select(ADMIN_USER_FIELDS.map((field) => `u.${field}`));

    if (filters.q) qb.andWhere('(u.name LIKE :q OR u.email LIKE :q)', { q: likeContains(filters.q) });
    if (filters.campus) qb.andWhere('u.campus = :campus', { campus: filters.campus });
    if (filters.role) qb.andWhere('u.role = :role', { role: filters.role });
    if (filters.verified) qb.andWhere(filters.verified === 'true' ? 'u.emailVerifiedAt IS NOT NULL' : 'u.emailVerifiedAt IS NULL');
    if (filters.status) qb.andWhere(filters.status === 'active' ? 'u.deactivatedAt IS NULL' : 'u.deactivatedAt IS NOT NULL');
    return qb.orderBy('u.createdAt', 'DESC').addOrderBy('u.id', 'ASC');
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
   * Bootstrap path for the first admin, used only by the admin:promote CLI (never over HTTP).
   * Looks the account up by canonical email, as login does, so Gmail dot/+tag variants find the
   * same account. Same transaction, locks and rules as an admin's own role change.
   */
  async promoteBySystem(email: string): Promise<AdminUserView> {
    const found = await this.dataSource
      .getRepository(User)
      .findOne({ where: { emailCanonical: canonicalEmail(email.trim().toLowerCase()) }, select: { id: true } });
    if (!found) throw new NotFoundException('No account uses this email address');

    return this.mutate(SYSTEM_ACTOR, found.id, 'promote-or-keep', async (m, target) => {
      if (target.deactivatedAt) throw new ConflictException('This account is deactivated; reactivate it before promoting it');
      if (!target.emailVerifiedAt) throw new BadRequestException('This account has not verified its email address yet');
      if (target.role === UserRole.ADMIN) throw new ConflictException('This account is already an admin');
      await m.update(User, { id: target.id }, { role: UserRole.ADMIN });
      await this.audit.record(m, {
        actorId: null,
        action: 'user.role_changed',
        targetType: 'user',
        targetId: target.id,
        metadata: { from: target.role, to: UserRole.ADMIN, actor: SYSTEM_ACTOR, via: 'cli' },
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
    actor: Actor | typeof SYSTEM_ACTOR,
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
        actor === SYSTEM_ACTOR ? SYSTEM_ACTOR : { id: actor.id },
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
