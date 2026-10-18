import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotifications1792800000000 implements MigrationInterface {
  name = 'CreateNotifications1792800000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`notifications\` (
      \`id\` varchar(36) NOT NULL,
      \`userId\` varchar(36) NOT NULL,
      \`type\` varchar(60) NOT NULL,
      \`title\` varchar(180) NOT NULL,
      \`body\` text NOT NULL,
      \`data\` json NULL,
      \`dedupeKey\` varchar(190) NULL,
      \`readAt\` datetime NULL,
      \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE INDEX \`UQ_notifications_dedupeKey\` (\`dedupeKey\`),
      INDEX \`IDX_notifications_user_created\` (\`userId\`, \`createdAt\`),
      INDEX \`IDX_notifications_user_read\` (\`userId\`, \`readAt\`),
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`FK_notifications_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP TABLE `notifications`'); }
}
