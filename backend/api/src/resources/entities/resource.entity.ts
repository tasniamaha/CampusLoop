import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum ItemCondition {
  NEW = 'new',
  GOOD = 'good',
  FAIR = 'fair',
  WORN = 'worn',
}

@Entity('resources')
export class Resource {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  ownerId!: string;

  @Column({ type: 'varchar', length: 36 })
  categoryId!: string;

  @Column({ type: 'varchar', length: 150 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: ItemCondition, default: ItemCondition.GOOD })
  itemCondition!: ItemCondition;

  @Column({ type: 'text', nullable: true })
  borrowingRules!: string | null;

  @Column({ type: 'int', default: 7 })
  maxLoanDays!: number;

  @Column({ type: 'varchar', length: 150, nullable: true })
  pickupLocation!: string | null;

  // Owner-controlled switch. Actual availability also depends on active loans.
  @Column({ type: 'boolean', default: true })
  isListed!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Soft delete: find()/QueryBuilder exclude these rows automatically.
  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true })
  deletedAt!: Date | null;
}