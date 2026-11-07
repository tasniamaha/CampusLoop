import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * approvedAt anchors the pickup window. updatedAt cannot: it moves on every write.
 * Backfilled from the latest 'approved' loan event, falling back to updatedAt for
 * approved rows that predate event logging.
 */
export class AddBorrowApprovedAt1793500000000 implements MigrationInterface {
  name = 'AddBorrowApprovedAt1793500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `borrow_requests` ADD COLUMN `approvedAt` datetime(6) NULL AFTER `message`');
    await q.query(`
      UPDATE \`borrow_requests\` br
      JOIN (
        SELECT \`borrowRequestId\`, MAX(\`createdAt\`) AS \`at\`
        FROM \`loan_events\`
        WHERE \`eventType\` = 'approved'
        GROUP BY \`borrowRequestId\`
      ) e ON e.\`borrowRequestId\` = br.\`id\`
      SET br.\`approvedAt\` = e.\`at\`
    `);
    await q.query(
      "UPDATE `borrow_requests` SET `approvedAt` = `updatedAt` WHERE `status` = 'approved' AND `approvedAt` IS NULL",
    );
    // Serve the expiry sweep: status first, then the time column it range-scans.
    await q.query('CREATE INDEX `IDX_borrow_status_approvedAt` ON `borrow_requests` (`status`, `approvedAt`)');
    await q.query('CREATE INDEX `IDX_borrow_status_dueDate` ON `borrow_requests` (`status`, `dueDate`)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX `IDX_borrow_status_dueDate` ON `borrow_requests`');
    await q.query('DROP INDEX `IDX_borrow_status_approvedAt` ON `borrow_requests`');
    await q.query('ALTER TABLE `borrow_requests` DROP COLUMN `approvedAt`');
  }
}
