import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BorrowStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  ACTIVE = 'active',
  RETURNED = 'returned',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

// Statuses that occupy the resource. Must match the generated column in the migration.
export const OCCUPYING_STATUSES = [BorrowStatus.APPROVED, BorrowStatus.ACTIVE];

@Entity('borrow_requests')
export class BorrowRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  resourceId!: string;

  @Column({ type: 'varchar', length: 36 })
  borrowerId!: string;

  @Column({ type: 'enum', enum: BorrowStatus, default: BorrowStatus.PENDING })
  status!: BorrowStatus;

  @Column({ type: 'datetime' })
  dueDate!: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  message!: string | null;

  // NOTE: the generated column `activeResourceId` exists only in the database
  // (see migration). It is deliberately NOT mapped here so TypeORM never writes to it.

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}