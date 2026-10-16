import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Append-only (DB triggers block UPDATE and DELETE). actorId null = performed by the system. */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  actorId!: string | null;

  /** e.g. 'resource.deleted', 'user.role_changed' */
  @Column({ type: 'varchar', length: 60 })
  action!: string;

  @Column({ type: 'varchar', length: 40 })
  targetType!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  targetId!: string | null;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}