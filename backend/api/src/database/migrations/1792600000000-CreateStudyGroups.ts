import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateStudyGroups1792600000000 implements MigrationInterface {
  name = 'CreateStudyGroups1792600000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE study_groups (
      id varchar(36) NOT NULL, creatorId varchar(36) NOT NULL, campus varchar(100) NOT NULL,
      title varchar(120) NOT NULL, courseCode varchar(40) NOT NULL, topic varchar(100) NOT NULL,
      description text NOT NULL, schedule varchar(500) NOT NULL, participantLimit smallint unsigned NOT NULL,
      approvalRequired tinyint(1) NOT NULL DEFAULT 1, status enum('open','archived') NOT NULL DEFAULT 'open',
      createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      INDEX IDX_study_groups_campus_status_course (campus,status,courseCode),
      INDEX IDX_study_groups_campus_topic (campus,topic), PRIMARY KEY(id),
      CONSTRAINT FK_study_groups_creator FOREIGN KEY (creatorId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await q.query(`CREATE TABLE study_group_members (
      id varchar(36) NOT NULL, groupId varchar(36) NOT NULL, userId varchar(36) NOT NULL, campus varchar(100) NOT NULL,
      role enum('owner','member') NOT NULL DEFAULT 'member', status enum('pending','active','rejected') NOT NULL DEFAULT 'pending',
      reviewedAt datetime(6) NULL, createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      UNIQUE INDEX UQ_study_group_member_group_user (groupId,userId),
      INDEX IDX_study_group_members_group_status (groupId,status), INDEX IDX_study_group_members_user_status (userId,status),
      PRIMARY KEY(id), CONSTRAINT FK_study_group_members_group FOREIGN KEY (groupId) REFERENCES study_groups(id) ON DELETE CASCADE,
      CONSTRAINT FK_study_group_members_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE study_group_members'); await q.query('DROP TABLE study_groups'); }
}
