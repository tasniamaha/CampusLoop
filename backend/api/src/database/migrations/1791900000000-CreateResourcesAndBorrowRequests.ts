import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateResourcesAndBorrowRequests1791900000000
  implements MigrationInterface
{
  name = 'CreateResourcesAndBorrowRequests1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`resources\` (
        \`id\` varchar(36) NOT NULL,
        \`ownerId\` varchar(36) NOT NULL,
        \`title\` varchar(150) NOT NULL,
        \`description\` text NULL,
        \`category\` varchar(50) NOT NULL,
        \`isListed\` tinyint NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_resources_category_listed\` (\`category\`, \`isListed\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_resources_owner\` FOREIGN KEY (\`ownerId\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`borrow_requests\` (
        \`id\` varchar(36) NOT NULL,
        \`resourceId\` varchar(36) NOT NULL,
        \`borrowerId\` varchar(36) NOT NULL,
        \`status\` enum ('pending','approved','active','returned','rejected','cancelled','expired') NOT NULL DEFAULT 'pending',
        \`dueDate\` datetime NOT NULL,
        \`message\` varchar(500) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`activeResourceId\` varchar(36) GENERATED ALWAYS AS (
          CASE WHEN \`status\` IN ('approved','active') THEN \`resourceId\` ELSE NULL END
        ) STORED,
        UNIQUE INDEX \`UQ_one_active_loan_per_resource\` (\`activeResourceId\`),
        INDEX \`IDX_borrow_resource_status\` (\`resourceId\`, \`status\`),
        INDEX \`IDX_borrow_borrower\` (\`borrowerId\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_borrow_resource\` FOREIGN KEY (\`resourceId\`) REFERENCES \`resources\`(\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`FK_borrow_borrower\` FOREIGN KEY (\`borrowerId\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`borrow_requests\``);
    await queryRunner.query(`DROP TABLE \`resources\``);
  }
}