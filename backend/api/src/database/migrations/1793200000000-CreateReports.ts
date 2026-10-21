import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReports1793200000000 implements MigrationInterface {
  name = 'CreateReports1793200000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`reports\` (
        \`id\` varchar(36) NOT NULL,
        \`reporterId\` varchar(36) NOT NULL,
        \`targetType\` enum('review','resource','lost_found') NOT NULL,
        \`targetId\` varchar(36) NOT NULL,
        \`reason\` varchar(255) NOT NULL,
        \`status\` enum('open','resolved','dismissed') NOT NULL DEFAULT 'open',
        \`resolvedById\` varchar(36) NULL,
        \`resolvedAt\` datetime(6) NULL,
        \`resolutionNote\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_reports_reporter_target\` (\`reporterId\`, \`targetType\`, \`targetId\`),
        INDEX \`IDX_reports_status_created\` (\`status\`, \`createdAt\`),
        INDEX \`IDX_reports_target\` (\`targetType\`, \`targetId\`),
        CONSTRAINT \`FK_reports_reporter\` FOREIGN KEY (\`reporterId\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`FK_reports_resolvedBy\` FOREIGN KEY (\`resolvedById\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `reports`');
  }
}
