import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
@Index('IDX_notifications_user_created', ['userId', 'createdAt'])
@Index('IDX_notifications_user_read', ['userId', 'readAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 60 })
  type!: string;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'json', nullable: true })
  data!: Record<string, string | number | boolean | null> | null;

  @Column({ type: 'varchar', length: 190, nullable: true, unique: true })
  dedupeKey!: string | null;

  @Column({ type: 'datetime', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
