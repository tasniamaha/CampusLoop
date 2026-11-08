import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin deactivation for users and resource categories, plus a refresh-token revoke reason for it.
 *
 * - users.deactivatedAt: NULL = active. A deactivated user can't log in, refresh, or use an access
 *   token (JwtAuthGuard checks the database on every request). Their content stays as it is.
 *   IDX_users_role_deactivated serves "count / lock the active admins" for last-admin protection.
 * - resource_categories.deactivatedAt: NULL = active. A deactivated category is hidden from the
 *   public list and can't be chosen for a resource; resources that already use it keep it.
 * - refresh_tokens.revokeReason gains 'deactivated'.
 *
 * down() first rewrites 'deactivated' revoke reasons to 'logout_all' (the enum can't shrink while
 * rows use the value), then drops the columns and index. Deactivation timestamps are lost.
 */
export class AddUserAndCategoryDeactivation1793700000000 implements MigrationInterface {
  name = 'AddUserAndCategoryDeactivation1793700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE \`users\`
        ADD COLUMN \`deactivatedAt\` datetime(6) NULL,
        ADD INDEX \`IDX_users_role_deactivated\` (\`role\`, \`deactivatedAt\`)
    `);
    await q.query('ALTER TABLE `resource_categories` ADD COLUMN `deactivatedAt` datetime(6) NULL');
    await q.query(`
      ALTER TABLE \`refresh_tokens\`
        MODIFY \`revokeReason\` enum('logout','logout_all','reuse_detected','password_reset','deactivated') NULL
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("UPDATE `refresh_tokens` SET `revokeReason` = 'logout_all' WHERE `revokeReason` = 'deactivated'");
    await q.query(`
      ALTER TABLE \`refresh_tokens\`
        MODIFY \`revokeReason\` enum('logout','logout_all','reuse_detected','password_reset') NULL
    `);
    await q.query('ALTER TABLE `resource_categories` DROP COLUMN `deactivatedAt`');
    await q.query('ALTER TABLE `users` DROP INDEX `IDX_users_role_deactivated`, DROP COLUMN `deactivatedAt`');
  }
}
