import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLostFoundReports1792400000000 implements MigrationInterface {
  name = 'CreateLostFoundReports1792400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE lost_found_reports (
        id varchar(36) NOT NULL,
        reporterId varchar(36) NOT NULL,
        campus varchar(100) NOT NULL,
        type enum ('lost','found') NOT NULL,
        title varchar(150) NOT NULL,
        description text NOT NULL,
        category varchar(80) NOT NULL,
        location varchar(180) NOT NULL,
        itemDate date NOT NULL,
        imageUrl varchar(500) NULL,
        status enum ('open','resolved') NOT NULL DEFAULT 'open',
        resolvedAt datetime(6) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX IDX_lost_found_campus_status_type (campus, status, type),
        INDEX IDX_lost_found_campus_category (campus, category),
        INDEX IDX_lost_found_reporter_created (reporterId, createdAt),
        PRIMARY KEY (id),
        CONSTRAINT FK_lost_found_reporter FOREIGN KEY (reporterId)
          REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE lost_found_reports');
  }
}
