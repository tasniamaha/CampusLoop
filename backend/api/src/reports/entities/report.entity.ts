import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReportTarget {
  REVIEW = 'review',
  RESOURCE = 'resource',
  LOST_FOUND = 'lost_found',
}

export enum ReportStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

@Entity('reports')
@Index('UQ_reports_reporter_target', ['reporterId', 'targetType', 'targetId'], {
  unique: true,
})
@Index('IDX_reports_status_created', ['status', 'createdAt'])
@Index('IDX_reports_target', ['targetType', 'targetId'])
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  reporterId!: string;

  @Column({ type: 'enum', enum: ReportTarget })
  targetType!: ReportTarget;

  @Column({ type: 'varchar', length: 36 })
  targetId!: string;

  @Column({ type: 'varchar', length: 255 })
  reason!: string;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.OPEN })
  status!: ReportStatus;

  @Column({ type: 'varchar', length: 36, nullable: true })
  resolvedById!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolutionNote!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
