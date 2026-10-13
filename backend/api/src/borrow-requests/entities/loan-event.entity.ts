import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { BorrowStatus } from './borrow-request.entity.js';

export enum LoanEventType {
  REQUESTED = 'requested',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  RETURNED = 'returned',
  EXPIRED = 'expired',
  HANDED_OVER = 'handed_over', // used by QR handover (approved -> active)
}

/** Append-only. There is intentionally no UpdateDateColumn and no code path that updates or deletes rows. */
@Entity('loan_events')
export class LoanEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  borrowRequestId!: string;

  @Column({ type: 'varchar', length: 36 })
  resourceId!: string;

  /** null = performed by the system (e.g. automatic expiry). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  actorId!: string | null;

  @Column({ type: 'enum', enum: LoanEventType })
  eventType!: LoanEventType;

  @Column({ type: 'enum', enum: BorrowStatus, nullable: true })
  fromStatus!: BorrowStatus | null;

  @Column({ type: 'enum', enum: BorrowStatus })
  toStatus!: BorrowStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}