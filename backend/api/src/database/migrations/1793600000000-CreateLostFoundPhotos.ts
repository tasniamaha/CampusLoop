import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Photos for lost-and-found reports, replacing the free-text imageUrl column.
 *
 * imageUrl is retired in two phases. This migration leaves the column and its data untouched: the
 * API stops accepting new values but still returns existing ones under the same visibility rule as
 * photos. A later migration drops the column.
 *
 * down() drops the table. The photo files on disk are not touched; re-running up() does not
 * reattach them.
 */
export class CreateLostFoundPhotos1793600000000 implements MigrationInterface {
  name = 'CreateLostFoundPhotos1793600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`lost_found_photos\` (
        \`id\` varchar(36) NOT NULL,
        \`reportId\` varchar(36) NOT NULL,
        \`storageKey\` varchar(80) NOT NULL,
        \`mimeType\` varchar(50) NOT NULL,
        \`sizeBytes\` int NOT NULL,
        \`sortOrder\` int NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_lost_found_photos_storageKey\` (\`storageKey\`),
        INDEX \`IDX_lost_found_photos_report_order\` (\`reportId\`, \`sortOrder\`),
        CONSTRAINT \`FK_lost_found_photos_report\` FOREIGN KEY (\`reportId\`)
          REFERENCES \`lost_found_reports\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `lost_found_photos`');
  }
}
