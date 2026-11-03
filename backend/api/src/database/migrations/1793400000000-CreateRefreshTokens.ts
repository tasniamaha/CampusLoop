import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokens1793400000000 implements MigrationInterface {
  name = 'CreateRefreshTokens1793400000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`refresh_tokens\` (
        \`id\` varchar(36) NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`familyId\` varchar(36) NOT NULL,
        \`tokenHash\` char(64) NOT NULL,
        \`expiresAt\` datetime(6) NOT NULL,
        \`familyExpiresAt\` datetime(6) NOT NULL,
        \`rotatedAt\` datetime(6) NULL,
        \`revokedAt\` datetime(6) NULL,
        \`revokeReason\` enum('logout','logout_all','reuse_detected','password_reset') NULL,
        \`userAgent\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_refresh_tokens_hash\` (\`tokenHash\`),
        INDEX \`IDX_refresh_tokens_family\` (\`familyId\`),
        INDEX \`IDX_refresh_tokens_user_revoked\` (\`userId\`, \`revokedAt\`),
        INDEX \`IDX_refresh_tokens_expires\` (\`expiresAt\`),
        CONSTRAINT \`FK_refresh_tokens_user\` FOREIGN KEY (\`userId\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `refresh_tokens`');
  }
}
