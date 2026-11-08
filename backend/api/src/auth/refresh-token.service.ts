import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { newOpaqueToken, sha256 } from '../verification/token.util.js';
import { RefreshRevokeReason, RefreshToken } from './entities/refresh-token.entity.js';

const DAY_MS = 86_400_000;
/** Sliding lifetime: an idle session dies after this. */
export const REFRESH_TTL_MS = 14 * DAY_MS;
/** Absolute lifetime of one login, however active. */
export const REFRESH_FAMILY_MAX_MS = 60 * DAY_MS;
/**
 * A rotated token presented again within this window is treated as a benign race
 * (parallel requests sharing one cookie), not theft. Outside it, the family is revoked.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export interface IssuedRefreshToken {
  raw: string;
  expiresAt: Date;
}

interface IssueOptions {
  familyId?: string;
  familyExpiresAt?: Date;
  userAgent?: string | null;
}

type RotateOutcome =
  | { kind: 'rotated'; userId: string; token: IssuedRefreshToken }
  | { kind: 'reuse'; userId: string; familyId: string }
  | { kind: 'invalid' };

const SESSION_EXPIRED = 'Session expired. Please log in again.';

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Starts a new session family (login). */
  issueForLogin(userId: string, userAgent: string | null): Promise<IssuedRefreshToken> {
    return this.issue(this.dataSource.manager, userId, { userAgent });
  }

  /**
   * Exchanges a refresh token for a new one. The presented row is locked so concurrent
   * rotations serialise; reuse of an already-rotated token revokes the whole family.
   */
  async rotate(raw: string, userAgent: string | null): Promise<{ userId: string; token: IssuedRefreshToken }> {
    // READ COMMITTED: under REPEATABLE READ the queued FOR UPDATE takes a next-key (gap) lock on the
    // hash index, and the holder's INSERT of the new hash into that gap deadlocks against it.
    // Correctness only needs the record lock on the presented row, which RC still takes.
    const outcome = await this.dataSource.transaction('READ COMMITTED', async (m): Promise<RotateOutcome> => {
      const now = new Date();
      const current = await m.findOne(RefreshToken, {
        where: { tokenHash: sha256(raw) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current || current.revokedAt || current.expiresAt.getTime() <= now.getTime()) {
        return { kind: 'invalid' };
      }

      const family = { familyId: current.familyId, familyExpiresAt: current.familyExpiresAt, userAgent };

      if (current.rotatedAt) {
        if (now.getTime() - current.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS) {
          const token = await this.issue(m, current.userId, family, now);
          return { kind: 'rotated', userId: current.userId, token };
        }
        await this.revokeWhere(m, { familyId: current.familyId }, RefreshRevokeReason.REUSE_DETECTED, now);
        await this.audit.record(m, {
          actorId: null,
          action: 'auth.refresh_reuse_detected',
          targetType: 'user',
          targetId: current.userId,
          metadata: { familyId: current.familyId },
        });
        return { kind: 'reuse', userId: current.userId, familyId: current.familyId };
      }

      await m.update(RefreshToken, { id: current.id }, { rotatedAt: now });
      const token = await this.issue(m, current.userId, family, now);
      return { kind: 'rotated', userId: current.userId, token };
    });

    // Thrown OUTSIDE the transaction so the reuse revocation above is committed, not rolled back.
    if (outcome.kind === 'reuse') {
      this.logger.warn(`Refresh token reuse: revoked family ${outcome.familyId} of user ${outcome.userId}`);
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    if (outcome.kind === 'invalid') throw new UnauthorizedException(SESSION_EXPIRED);
    return { userId: outcome.userId, token: outcome.token };
  }

  /** Ends the session the token belongs to. Silent for unknown tokens (no validity oracle). */
  async revokeFamilyOf(raw: string): Promise<void> {
    const row = await this.dataSource
      .getRepository(RefreshToken)
      .findOne({ where: { tokenHash: sha256(raw) }, select: { id: true, familyId: true } });
    if (!row) return;
    await this.revokeWhere(this.dataSource.manager, { familyId: row.familyId }, RefreshRevokeReason.LOGOUT);
  }

  /** Ends every session of a user. Pass the caller's manager to commit with its transaction. */
  revokeAllForUser(
    userId: string,
    reason: RefreshRevokeReason.LOGOUT_ALL | RefreshRevokeReason.PASSWORD_RESET | RefreshRevokeReason.DEACTIVATED,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    return this.revokeWhere(manager, { userId }, reason);
  }

  private async issue(
    manager: EntityManager,
    userId: string,
    opts: IssueOptions,
    now: Date = new Date(),
  ): Promise<IssuedRefreshToken> {
    const raw = newOpaqueToken();
    const familyExpiresAt = opts.familyExpiresAt ?? new Date(now.getTime() + REFRESH_FAMILY_MAX_MS);
    const expiresAt = new Date(Math.min(now.getTime() + REFRESH_TTL_MS, familyExpiresAt.getTime()));
    await manager.insert(RefreshToken, {
      id: randomUUID(),
      userId,
      familyId: opts.familyId ?? randomUUID(),
      tokenHash: sha256(raw),
      expiresAt,
      familyExpiresAt,
      rotatedAt: null,
      revokedAt: null,
      revokeReason: null,
      userAgent: opts.userAgent?.slice(0, 255) || null,
      createdAt: now,
    });
    return { raw, expiresAt };
  }

  private async revokeWhere(
    manager: EntityManager,
    where: { familyId: string } | { userId: string },
    reason: RefreshRevokeReason,
    now: Date = new Date(),
  ): Promise<void> {
    await manager.update(RefreshToken, { ...where, revokedAt: IsNull() }, { revokedAt: now, revokeReason: reason });
  }
}
