import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum RefreshRevokeReason {
  LOGOUT = 'logout',
  LOGOUT_ALL = 'logout_all',
  REUSE_DETECTED = 'reuse_detected',
  PASSWORD_RESET = 'password_reset',
}

/**
 * One row per issued refresh token. Only the SHA-256 hash is stored.
 * A "family" is one login session; every rotation adds a row to the same family.
 */
@Entity('refresh_tokens')
@Index('UQ_refresh_tokens_hash', ['tokenHash'], { unique: true })
@Index('IDX_refresh_tokens_family', ['familyId'])
@Index('IDX_refresh_tokens_user_revoked', ['userId', 'revokedAt'])
@Index('IDX_refresh_tokens_expires', ['expiresAt'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 36 })
  familyId!: string;

  @Column({ type: 'char', length: 64 })
  tokenHash!: string;

  /** Sliding expiry of this token. */
  @Column({ type: 'datetime', precision: 6 })
  expiresAt!: Date;

  /** Absolute session cap, copied unchanged to every token in the family. */
  @Column({ type: 'datetime', precision: 6 })
  familyExpiresAt!: Date;

  /** Set when this token was exchanged for a newer one. */
  @Column({ type: 'datetime', precision: 6, nullable: true })
  rotatedAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'enum', enum: RefreshRevokeReason, nullable: true })
  revokeReason!: RefreshRevokeReason | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
