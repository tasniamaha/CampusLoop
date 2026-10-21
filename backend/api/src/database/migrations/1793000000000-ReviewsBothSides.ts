import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewsBothSides1793000000000 implements MigrationInterface {
  name = 'ReviewsBothSides1793000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`reviews\`
      ADD COLUMN \`reviewerRole\` ENUM('borrower','owner') NOT NULL DEFAULT 'borrower' AFTER \`reviewerId\`,
      ADD COLUMN \`revieweeId\` varchar(36) NULL AFTER \`reviewerRole\``);

    // Existing rows are all borrower -> owner reviews.
    await q.query(`UPDATE \`reviews\` rv JOIN \`resources\` r ON r.id = rv.resourceId
      SET rv.revieweeId = r.ownerId`);
    await q.query(`ALTER TABLE \`reviews\` MODIFY \`revieweeId\` varchar(36) NOT NULL`);

    // Create the new unique key BEFORE dropping the old one: the borrowRequestId
    // foreign key needs an index that starts with that column at all times.
    await q.query(`CREATE UNIQUE INDEX \`UQ_reviews_loan_reviewer\`
      ON \`reviews\` (\`borrowRequestId\`, \`reviewerId\`)`);
    await q.query(`DROP INDEX \`UQ_reviews_borrowRequestId\` ON \`reviews\``);

    await q.query(`CREATE INDEX \`IDX_reviews_reviewee\` ON \`reviews\` (\`revieweeId\`)`);
    await q.query(`ALTER TABLE \`reviews\` ADD CONSTRAINT \`FK_reviews_reviewee\`
      FOREIGN KEY (\`revieweeId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`reviews\` ADD CONSTRAINT \`CHK_reviews_rating\`
      CHECK (\`rating\` BETWEEN 1 AND 5)`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Owner-written reviews cannot fit the old one-review-per-loan key.
    await q.query(`DELETE FROM \`reviews\` WHERE \`reviewerRole\` = 'owner'`);
    await q.query(`ALTER TABLE \`reviews\` DROP CONSTRAINT \`CHK_reviews_rating\``);
    await q.query(`ALTER TABLE \`reviews\` DROP FOREIGN KEY \`FK_reviews_reviewee\``);
    await q.query(`DROP INDEX \`IDX_reviews_reviewee\` ON \`reviews\``);
    await q.query(`CREATE UNIQUE INDEX \`UQ_reviews_borrowRequestId\` ON \`reviews\` (\`borrowRequestId\`)`);
    await q.query(`DROP INDEX \`UQ_reviews_loan_reviewer\` ON \`reviews\``);
    await q.query(`ALTER TABLE \`reviews\` DROP COLUMN \`revieweeId\`, DROP COLUMN \`reviewerRole\``);
  }
}