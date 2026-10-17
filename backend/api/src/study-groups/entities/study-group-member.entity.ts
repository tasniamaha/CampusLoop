import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum StudyGroupMemberStatus { PENDING = 'pending', ACTIVE = 'active', REJECTED = 'rejected' }
export enum StudyGroupMemberRole { OWNER = 'owner', MEMBER = 'member' }

@Entity('study_group_members')
@Index('UQ_study_group_member_group_user', ['groupId', 'userId'], { unique: true })
@Index('IDX_study_group_members_group_status', ['groupId', 'status'])
@Index('IDX_study_group_members_user_status', ['userId', 'status'])
export class StudyGroupMember {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 36 }) groupId!: string;
  @Column({ type: 'varchar', length: 36 }) userId!: string;
  @Column({ type: 'varchar', length: 100 }) campus!: string;
  @Column({ type: 'enum', enum: StudyGroupMemberRole, default: StudyGroupMemberRole.MEMBER }) role!: StudyGroupMemberRole;
  @Column({ type: 'enum', enum: StudyGroupMemberStatus, default: StudyGroupMemberStatus.PENDING }) status!: StudyGroupMemberStatus;
  @Column({ type: 'datetime', precision: 6, nullable: true }) reviewedAt!: Date | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt!: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt!: Date;
}
