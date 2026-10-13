import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoanEvents1792100000000 implements MigrationInterface {
  name = 'CreateLoanEvents1792100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE loan_events (
        id varchar(36) NOT NULL,
        borrowRequestId varchar(36) NOT NULL,
        resourceId varchar(36) NOT NULL,
        actorId varchar(36) NULL,
        eventType enum ('requested','approved','rejected','cancelled','returned','expired','handed_over') NOT NULL,
        fromStatus enum ('pending','approved','active','returned','rejected','cancelled','expired') NULL,
        toStatus enum ('pending','approved','active','returned','rejected','cancelled','expired') NOT NULL,
        note varchar(255) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX IDX_loan_events_request (borrowRequestId, createdAt),
        INDEX IDX_loan_events_resource (resourceId, createdAt),
        CONSTRAINT FK_loan_events_request FOREIGN KEY (borrowRequestId) REFERENCES borrow_requests(id) ON DELETE RESTRICT,
        CONSTRAINT FK_loan_events_resource FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE RESTRICT,
        CONSTRAINT FK_loan_events_actor FOREIGN KEY (actorId) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    // Existing requests get one "requested" event. Their earlier transitions were never recorded.
    await q.query(`
      INSERT INTO loan_events (id, borrowRequestId, resourceId, actorId, eventType, fromStatus, toStatus, note, createdAt)
      SELECT UUID(), id, resourceId, borrowerId, 'requested', NULL, 'pending',
             'Backfilled before event logging was introduced', createdAt
      FROM borrow_requests
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE loan_events`);
  }
}