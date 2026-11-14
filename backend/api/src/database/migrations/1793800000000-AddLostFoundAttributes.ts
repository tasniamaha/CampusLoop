import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Structured attributes on lost-and-found reports for matching (project.md §4.4, §7).
 *
 * - color: one of the fixed form colours (LOST_FOUND_COLORS), or NULL when not given.
 * - brand: free text, trimmed, or NULL when not given.
 * - itemDateTo: the end of the time window. itemDate stays as the window start; NULL means a
 *   single day, so existing rows need no backfill.
 *
 * CHK_lost_found_item_window keeps a window that ends before it starts, or spans more than
 * 30 days, out of the table even if a caller skips the service checks.
 *
 * down() drops the check and the three columns. Values entered in them are lost.
 */
export class AddLostFoundAttributes1793800000000 implements MigrationInterface {
  name = 'AddLostFoundAttributes1793800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE \`lost_found_reports\`
        ADD COLUMN \`color\` varchar(30) NULL,
        ADD COLUMN \`brand\` varchar(60) NULL,
        ADD COLUMN \`itemDateTo\` date NULL,
        ADD CONSTRAINT \`CHK_lost_found_item_window\`
          CHECK (\`itemDateTo\` IS NULL OR (\`itemDateTo\` >= \`itemDate\` AND DATEDIFF(\`itemDateTo\`, \`itemDate\`) <= 30))
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE \`lost_found_reports\`
        DROP CHECK \`CHK_lost_found_item_window\`,
        DROP COLUMN \`itemDateTo\`,
        DROP COLUMN \`brand\`,
        DROP COLUMN \`color\`
    `);
  }
}
