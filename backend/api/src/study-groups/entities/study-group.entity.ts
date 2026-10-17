import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum StudyGroupStatus { OPEN = 'open', ARCHIVED = 'archived' }

@Entity('study_groups')
@Index('IDX_study_groups_campus_status_course', ['campus', 'status', 'courseCode'])
@Index('IDX_study_groups_campus_topic', ['campus', 'topic'])
export class StudyGroup {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 36 }) creatorId!: string;
  @Column({ type: 'varchar', length: 100 }) campus!: string;
  @Column({ type: 'varchar', length: 120 }) title!: string;
  @Column({ type: 'varchar', length: 40 }) courseCode!: string;
  @Column({ type: 'varchar', length: 100 }) topic!: string;
  @Column({ type: 'text' }) description!: string;
  @Column({ type: 'varchar', length: 500 }) schedule!: string;
  @Column({ type: 'smallint', unsigned: true }) participantLimit!: number;
  @Column({ type: 'boolean', default: true }) approvalRequired!: boolean;
  @Column({ type: 'enum', enum: StudyGroupStatus, default: StudyGroupStatus.OPEN }) status!: StudyGroupStatus;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt!: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt!: Date;
}
