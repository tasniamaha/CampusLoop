import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1792300000000 implements MigrationInterface {
  name = 'CreateAuditLogs1792300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE audit_logs (
        id varchar(36) NOT NULL,
        actorId varchar(36) NULL,
        action varchar(60) NOT NULL,
        targetType varchar(40) NOT NULL,
        targetId varchar(36) NULL,
        metadata json NULL,
        ipAddress varchar(45) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX IDX_audit_logs_actor (actorId, createdAt),
        INDEX IDX_audit_logs_target (targetType, targetId, createdAt),
        INDEX IDX_audit_logs_action (action, createdAt)
      ) ENGINE=InnoDB
    `);

    // Append-only is enforced by the database, not by convention.
    await q.query(`
      CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'
    `);
    await q.query(`
      CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE audit_logs`); // dropping the table drops its triggers
  }
}