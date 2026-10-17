import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LostFoundType {
  LOST = 'lost',
  FOUND = 'found',
}

export enum LostFoundStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

@Entity('lost_found_reports')
@Index('IDX_lost_found_campus_status_type', ['campus', 'status', 'type'])
@Index('IDX_lost_found_campus_category', ['campus', 'category'])
@Index('IDX_lost_found_reporter_created', ['reporterId', 'createdAt'])
export class LostFoundReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  reporterId!: string;

  // Snapshot the campus at report creation so matching/listing remains scoped.
  @Column({ type: 'varchar', length: 100 })
  campus!: string;

  @Column({ type: 'enum', enum: LostFoundType })
  type!: LostFoundType;

  @Column({ type: 'varchar', length: 150 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 80 })
  category!: string;

  @Column({ type: 'varchar', length: 180 })
  location!: string;

  @Column({ type: 'date' })
  itemDate!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'enum', enum: LostFoundStatus, default: LostFoundStatus.OPEN })
  status!: LostFoundStatus;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
