import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewHalfStarRatings1793300000000 implements MigrationInterface {
  name = 'ReviewHalfStarRatings1793300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `reviews` DROP CONSTRAINT `CHK_reviews_rating`');
    await queryRunner.query('ALTER TABLE `reviews` MODIFY COLUMN `rating` decimal(2,1) NOT NULL');
    await queryRunner.query(
      'ALTER TABLE `reviews` ADD CONSTRAINT `CHK_reviews_rating` ' +
        'CHECK (`rating` BETWEEN 0.5 AND 5 AND MOD(`rating` * 2, 1) = 0)',
    );
  }

  // Refuses to run if half-star reviews exist, so a rollback never rewrites anyone's rating.
  async down(queryRunner: QueryRunner): Promise<void> {
    const [row] = await queryRunner.query(
      'SELECT COUNT(*) AS n FROM `reviews` WHERE `rating` <> FLOOR(`rating`)',
    );
    if (Number(row.n) > 0) {
      throw new Error('Cannot revert: half-star reviews exist and would be altered.');
    }
    await queryRunner.query('ALTER TABLE `reviews` DROP CONSTRAINT `CHK_reviews_rating`');
    await queryRunner.query('ALTER TABLE `reviews` MODIFY COLUMN `rating` tinyint unsigned NOT NULL');
    await queryRunner.query(
      'ALTER TABLE `reviews` ADD CONSTRAINT `CHK_reviews_rating` CHECK (`rating` BETWEEN 1 AND 5)',
    );
  }
}