import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { MIGRATIONS_GLOB } from '../src/database/migrations-glob.js';

// up()/down() of AddLostFoundAttributes on the real test database. Always ends fully migrated.
// The CHECK constraint must hold even for writes that bypass the service.
const SCHEMA = process.env.TEST_DB_NAME ?? 'campusloop_test';
const NAME = 'AddLostFoundAttributes1793800000000';
const NEW_COLUMNS = ['brand', 'color', 'itemDateTo'];
const conn = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3317),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'root',
};

let ds: DataSource;
const userId = randomUUID();
const legacyId = randomUUID();
const insertedIds: string[] = [legacyId];

const columns = async () =>
  ((await ds.query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'lost_found_reports' AND COLUMN_NAME IN ('brand', 'color', 'itemDateTo')
     ORDER BY COLUMN_NAME`,
    [SCHEMA],
  )) as Array<{ name: string; type: string; nullable: string; length: string | number | null }>)
    // CHARACTER_MAXIMUM_LENGTH is a BIGINT, which the driver returns as a string.
    .map((c) => ({ ...c, length: c.length === null ? null : Number(c.length) }));

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

/** Inserts a report directly, bypassing the service. */
function insert(window: { from: string; to: string | null }) {
  const id = randomUUID();
  insertedIds.push(id);
  return ds.query(
    `INSERT INTO lost_found_reports (id, reporterId, campus, type, title, description, category, location, itemDate, itemDateTo, color, brand)
     VALUES (?, ?, 'lfa-mig', 'lost', 'Bottle', 'Steel bottle', 'Bottle', 'Library', ?, ?, 'blue', 'Milton')`,
    [id, userId, window.from, window.to],
  );
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
    `INSERT INTO users (id, name, email, emailCanonical, passwordHash, campus) VALUES (?, 'lfa-mig', ?, ?, 'x', 'lfa-mig')`,
    [userId, `lfa-mig-${userId}@example.com`, `lfa-mig-${userId}@example.com`],
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    await ds.runMigrations(); // always leave the test database fully migrated
    await ds.query(`DELETE FROM lost_found_reports WHERE id IN (${insertedIds.map(() => '?').join(',')})`, insertedIds);
    await ds.query('DELETE FROM users WHERE id = ?', [userId]);
    await ds.destroy();
  }
});

describe('AddLostFoundAttributes migration', () => {
  it('up() adds three nullable columns', async () => {
    expect(await columns()).toEqual([
      { name: 'brand', type: 'varchar', nullable: 'YES', length: 60 },
      { name: 'color', type: 'varchar', nullable: 'YES', length: 30 },
      { name: 'itemDateTo', type: 'date', nullable: 'YES', length: null },
    ]);
  });

  it('accepts a single day and windows of up to 30 days', async () => {
    await expect(insert({ from: '2026-10-01', to: null })).resolves.toBeDefined();
    await expect(insert({ from: '2026-10-01', to: '2026-10-01' })).resolves.toBeDefined();
    await expect(insert({ from: '2026-10-01', to: '2026-10-31' })).resolves.toBeDefined();
  });

  it('rejects, in the database, a window that ends first or spans more than 30 days', async () => {
    await expect(insert({ from: '2026-10-05', to: '2026-10-04' })).rejects.toThrow(/CHK_lost_found_item_window/);
    await expect(insert({ from: '2026-10-01', to: '2026-11-01' })).rejects.toThrow(/CHK_lost_found_item_window/);
  });

  it('down() drops the columns and the check, and keeps existing reports', async () => {
    await undoThrough(NAME);
    expect(await columns()).toEqual([]);
    await ds.query(
      `INSERT INTO lost_found_reports (id, reporterId, campus, type, title, description, category, location, itemDate)
       VALUES (?, ?, 'lfa-mig', 'found', 'Legacy', 'Legacy report', 'Misc', 'Hall', '2026-10-01')`,
      [legacyId, userId],
    );
    const rows = (await ds.query(
      `SELECT COUNT(*) AS n FROM lost_found_reports WHERE id IN (${insertedIds.map(() => '?').join(',')})`,
      insertedIds,
    )) as Array<{ n: string | number }>;
    expect(Number(rows[0].n)).toBe(4); // three windows from above plus the legacy row
  });

  it('up() runs again cleanly, and old rows read as single-day reports with no attributes', async () => {
    await ds.runMigrations();
    expect((await executedNewestFirst()).includes(NAME)).toBe(true);
    expect((await columns()).map((c) => c.name)).toEqual(NEW_COLUMNS);
    const [row] = await ds.query('SELECT itemDateTo, color, brand FROM lost_found_reports WHERE id = ?', [legacyId]);
    expect(row).toEqual({ itemDateTo: null, color: null, brand: null });
  });
});
