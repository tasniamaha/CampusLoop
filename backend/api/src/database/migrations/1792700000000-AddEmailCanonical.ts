import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailCanonical1792700000000 implements MigrationInterface {
  name = 'AddEmailCanonical1792700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN emailCanonical VARCHAR(254) NULL`);
    await q.query(`
      UPDATE users SET emailCanonical = CASE
        WHEN SUBSTRING_INDEX(email,'@',-1) IN ('gmail.com','googlemail.com')
        THEN CONCAT(REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(email,'@',1),'+',1),'.',''),'@gmail.com')
        ELSE email END`);
    await q.query(`ALTER TABLE users MODIFY emailCanonical VARCHAR(254) NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX UQ_users_emailCanonical ON users (emailCanonical)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX UQ_users_emailCanonical ON users`);
    await q.query(`ALTER TABLE users DROP COLUMN emailCanonical`);
  }
}