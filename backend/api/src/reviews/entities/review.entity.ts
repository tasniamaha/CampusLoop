import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('reviews')
@Index('UQ_reviews_loan_reviewer', ['borrowRequestId', 'reviewerId'], {
  unique: true,
})
@Index('IDX_reviews_resource_created', ['resourceId', 'createdAt'])
@Index('IDX_reviews_reviewer', ['reviewerId'])
@Index('IDX_reviews_reviewee', ['revieweeId'])
@Index('IDX_reviews_reviewee_hidden', ['revieweeId', 'isHidden'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  borrowRequestId!: string;

  @Column({ type: 'varchar', length: 36 })
  resourceId!: string;

  @Column({ type: 'varchar', length: 36 })
  reviewerId!: string;

  @Column({ type: 'enum', enum: ['borrower', 'owner'], default: 'borrower' })
  reviewerRole!: 'borrower' | 'owner';

  @Column({ type: 'varchar', length: 36 })
  revieweeId!: string;

  @Column({
    type: 'decimal',
    precision: 2,
    scale: 1,
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value),
    },
  })
  rating!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  comment!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  revealedAt!: Date | null;

  @Column({ type: 'datetime', precision: 6 })
  windowClosesAt!: Date;

  @Column({ type: 'boolean', default: false })
  isHidden!: boolean;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  hiddenAt!: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  hiddenById!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  hiddenReason!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
