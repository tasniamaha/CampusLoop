import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLostFoundClaims1792500000000 implements MigrationInterface {
  name = 'CreateLostFoundClaims1792500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE lost_found_claims (
        id varchar(36) NOT NULL,
        reportId varchar(36) NOT NULL,
        claimantId varchar(36) NOT NULL,
        campus varchar(100) NOT NULL,
        proofDetails text NOT NULL,
        status enum ('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        reviewerNote varchar(500) NULL,
        reviewedAt datetime(6) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_lost_found_claim_report_claimant (reportId, claimantId),
        INDEX IDX_lost_found_claim_report_status (reportId, status),
        INDEX IDX_lost_found_claim_campus_created (campus, createdAt),
        CONSTRAINT FK_lost_found_claim_report FOREIGN KEY (reportId)
          REFERENCES lost_found_reports(id) ON DELETE CASCADE,
        CONSTRAINT FK_lost_found_claimant FOREIGN KEY (claimantId)
          REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE lost_found_claims');
  }
}
