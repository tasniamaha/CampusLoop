import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewBlindAndModeration1793100000000
  implements MigrationInterface
{
  name = 'ReviewBlindAndModeration1793100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`reviews\`
      ADD COLUMN \`isHidden\` tinyint(1) NOT NULL DEFAULT 0,
      ADD COLUMN \`hiddenAt\` datetime(6) NULL,
      ADD COLUMN \`hiddenById\` varchar(36) NULL,
      ADD COLUMN \`hiddenReason\` varchar(255) NULL,
      ADD COLUMN \`revealedAt\` datetime(6) NULL,
      ADD COLUMN \`windowClosesAt\` datetime(6) NULL`);

    await q.query(`UPDATE \`reviews\`
      SET \`revealedAt\` = \`createdAt\`, \`windowClosesAt\` = \`createdAt\``);
    await q.query(
      `ALTER TABLE \`reviews\` MODIFY \`windowClosesAt\` datetime(6) NOT NULL`,
    );

    await q.query(`ALTER TABLE \`reviews\` ADD CONSTRAINT \`FK_reviews_hiddenBy\`
      FOREIGN KEY (\`hiddenById\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL`);
    await q.query(
      `CREATE INDEX \`IDX_reviews_reviewee_hidden\` ON \`reviews\` (\`revieweeId\`, \`isHidden\`)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX \`IDX_reviews_reviewee_hidden\` ON \`reviews\``);
    await q.query(
      `ALTER TABLE \`reviews\` DROP FOREIGN KEY \`FK_reviews_hiddenBy\``,
    );
    await q.query(`ALTER TABLE \`reviews\`
      DROP COLUMN \`windowClosesAt\`, DROP COLUMN \`revealedAt\`,
      DROP COLUMN \`hiddenReason\`, DROP COLUMN \`hiddenById\`,
      DROP COLUMN \`hiddenAt\`, DROP COLUMN \`isHidden\``);
  }
}
