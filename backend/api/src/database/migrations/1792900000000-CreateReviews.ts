
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviews1792900000000 implements MigrationInterface {
  name = 'CreateReviews1792900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`reviews\` (
        \`id\` varchar(36) NOT NULL,
        \`borrowRequestId\` varchar(36) NOT NULL,
        \`resourceId\` varchar(36) NOT NULL,
        \`reviewerId\` varchar(36) NOT NULL,
        \`rating\` tinyint unsigned NOT NULL,
        \`comment\` varchar(1000) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),

        UNIQUE INDEX \`UQ_reviews_borrowRequestId\` (\`borrowRequestId\`),
        INDEX \`IDX_reviews_resource_created\` (\`resourceId\`, \`createdAt\`),
        INDEX \`IDX_reviews_reviewer\` (\`reviewerId\`),

        PRIMARY KEY (\`id\`),

        CONSTRAINT \`FK_reviews_borrowRequest\`
          FOREIGN KEY (\`borrowRequestId\`)
          REFERENCES \`borrow_requests\` (\`id\`)
          ON DELETE CASCADE,

        CONSTRAINT \`FK_reviews_resource\`
          FOREIGN KEY (\`resourceId\`)
          REFERENCES \`resources\` (\`id\`)
          ON DELETE CASCADE,

        CONSTRAINT \`FK_reviews_reviewer\`
          FOREIGN KEY (\`reviewerId\`)
          REFERENCES \`users\` (\`id\`)
          ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `reviews`');
  }
}
