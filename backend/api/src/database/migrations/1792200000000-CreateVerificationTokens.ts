import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVerificationTokens1792200000000 implements MigrationInterface {
  name = 'CreateVerificationTokens1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`verification_tokens\` (
        \`id\` varchar(36) NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`type\` enum ('email_verify', 'password_reset') NOT NULL,
        \`tokenHash\` char(64) NOT NULL,
        \`expiresAt\` datetime(6) NOT NULL,
        \`usedAt\` datetime(6) NULL,
        \`createdAt\` datetime(6) NOT NULL,
        UNIQUE INDEX \`UQ_verification_tokens_hash\` (\`tokenHash\`),
        INDEX \`IDX_verification_tokens_user_type_created\` (\`userId\`, \`type\`, \`createdAt\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_verification_tokens_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`verification_tokens\``);
  }
}