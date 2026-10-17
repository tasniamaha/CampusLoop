import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LostFoundClaimStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('lost_found_claims')
@Index('UQ_lost_found_claim_report_claimant', ['reportId', 'claimantId'], { unique: true })
@Index('IDX_lost_found_claim_report_status', ['reportId', 'status'])
@Index('IDX_lost_found_claim_campus_created', ['campus', 'createdAt'])
export class LostFoundClaim {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  reportId!: string;

  @Column({ type: 'varchar', length: 36 })
  claimantId!: string;

  @Column({ type: 'varchar', length: 100 })
  campus!: string;

  // Private evidence visible only to the report creator and the claimant.
  @Column({ type: 'text' })
  proofDetails!: string;

  @Column({ type: 'enum', enum: LostFoundClaimStatus, default: LostFoundClaimStatus.PENDING })
  status!: LostFoundClaimStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reviewerNote!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
