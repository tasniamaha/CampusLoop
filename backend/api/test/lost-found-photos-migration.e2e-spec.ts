import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { MIGRATIONS_GLOB } from '../src/database/migrations-glob.js';

// up()/down() of CreateLostFoundPhotos on the real test database. Always ends fully migrated.
// down() must drop only the new table: the legacy imageUrl column and its data stay (phase 1).
const SCHEMA = process.env.TEST_DB_NAME ?? 'campusloop_test';
const NAME = 'CreateLostFoundPhotos1793600000000';
const conn = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3317),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'root',
};

let ds: DataSource;
const userId = randomUUID();
const reportId = randomUUID();

const tableExists = async () =>
  ((await ds.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'lost_found_photos'`,
    [SCHEMA],
  )) as Array<{ n: string | number }>)[0].n == 1;

const executedNewestFirst = async () =>
  ((await ds.query('SELECT name FROM migrations ORDER BY id DESC')) as Array<{ name: string }>).map((r) => r.name);

/** Undo by name, so newer migrations added later do not break this test. */
async function undoThrough(name: string) {
  for (;;) {
    const executed = await executedNewestFirst();
    if (!executed.includes(name)) throw new Error(`Migration ${name} is not applied`);
    const newest = executed[0];
    await ds.undoLastMigration();
    if (newest === name) return;
  }
}

beforeAll(async () => {
  ds = new DataSource({
    type: 'mysql',
    timezone: 'Z',
    ...conn,
    database: SCHEMA,
    entities: [],
    migrations: [MIGRATIONS_GLOB],
    synchronize: false,
    dropSchema: false,
  });
  await ds.initialize();
  await ds.runMigrations();

  await ds.query(
    `INSERT INTO users (id, name, email, emailCanonical, passwordHash, campus) VALUES (?, 'lfp-mig', ?, ?, 'x', 'lfp-mig')`,
    [userId, `lfp-mig-${userId}@example.com`, `lfp-mig-${userId}@example.com`],
  );
  await ds.query(
    `INSERT INTO lost_found_reports (id, reporterId, campus, type, title, description, category, location, itemDate, imageUrl)
     VALUES (?, ?, 'lfp-mig', 'found', 'Legacy', 'Legacy report', 'Misc', 'Hall', '2026-10-01', 'https://example.com/legacy.jpg')`,
    [reportId, userId],
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    await ds.runMigrations(); // always leave the test database fully migrated
    await ds.query('DELETE FROM lost_found_reports WHERE id = ?', [reportId]);
    await ds.query('DELETE FROM users WHERE id = ?', [userId]);
    await ds.destroy();
  }
});

describe('CreateLostFoundPhotos migration', () => {
  it('up() creates the table with a unique key and a cascading FK to reports', async () => {
    expect(await tableExists()).toBe(true);
    const [fk] = await ds.query(
      `SELECT DELETE_RULE AS rule, REFERENCED_TABLE_NAME AS ref FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = 'FK_lost_found_photos_report'`,
      [SCHEMA],
    );
    expect(fk).toEqual({ rule: 'CASCADE', ref: 'lost_found_reports' });

    const photoId = randomUUID();
    await ds.query(
      `INSERT INTO lost_found_photos (id, reportId, storageKey, mimeType, sizeBytes) VALUES (?, ?, ?, 'image/jpeg', 1)`,
      [photoId, reportId, `${randomUUID()}.jpg`],
    );
    const [dupe] = await ds.query('SELECT storageKey FROM lost_found_photos WHERE id = ?', [photoId]);
    await expect(
      ds.query(`INSERT INTO lost_found_photos (id, reportId, storageKey, mimeType, sizeBytes) VALUES (?, ?, ?, 'image/jpeg', 1)`, [
        randomUUID(),
        reportId,
        dupe.storageKey,
      ]),
    ).rejects.toThrow(/Duplicate/);
  });

  it('down() drops only the photos table; legacy imageUrl data is untouched', async () => {
    await undoThrough(NAME);
    expect(await tableExists()).toBe(false);
    const [row] = await ds.query('SELECT imageUrl FROM lost_found_reports WHERE id = ?', [reportId]);
    expect(row.imageUrl).toBe('https://example.com/legacy.jpg');
  });

  it('up() runs again cleanly after down()', async () => {
    await ds.runMigrations();
    expect(await tableExists()).toBe(true);
    expect((await executedNewestFirst()).includes(NAME)).toBe(true);
  });
});
