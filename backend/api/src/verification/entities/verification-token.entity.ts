import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum VerificationType {
  EMAIL_VERIFY = 'email_verify',
  PASSWORD_RESET = 'password_reset',
}

@Entity('verification_tokens')
@Index('UQ_verification_tokens_hash', ['tokenHash'], { unique: true })
@Index('IDX_verification_tokens_user_type_created', ['userId', 'type', 'createdAt'])
export class VerificationToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'enum', enum: VerificationType })
  type!: VerificationType;

  @Column({ type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'datetime', precision: 6 })
  expiresAt!: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  usedAt!: Date | null;

  @Column({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
