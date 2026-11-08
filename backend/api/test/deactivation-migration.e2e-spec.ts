import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { MIGRATIONS_GLOB } from '../src/database/migrations-glob.js';

// up()/down() of AddUserAndCategoryDeactivation on the real test database. Always ends fully migrated.
const SCHEMA = process.env.TEST_DB_NAME ?? 'campusloop_test';
const NAME = 'AddUserAndCategoryDeactivation1793700000000';
const conn = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3317),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'root',
};

let ds: DataSource;
const userId = randomUUID();
const tokenId = randomUUID();

const column = async (table: string, name: string) =>
  ((await ds.query(
    `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [SCHEMA, table, name],
  )) as Array<{ type: string }>)[0]?.type ?? null;

const hasIndex = async () =>
  ((await ds.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'IDX_users_role_deactivated'`,
    [SCHEMA],
  )) as Array<{ n: string | number }>)[0].n != 0;

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
    `INSERT INTO users (id, name, email, emailCanonical, passwordHash, campus, deactivatedAt) VALUES (?, 'deact-mig', ?, ?, 'x', 'deact-mig', ?)`,
    [userId, `deact-mig-${userId}@example.com`, `deact-mig-${userId}@example.com`, new Date()],
  );
  const far = new Date(Date.now() + 86_400_000);
  await ds.query(
    `INSERT INTO refresh_tokens (id, userId, familyId, tokenHash, expiresAt, familyExpiresAt, revokedAt, revokeReason)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'deactivated')`,
    [tokenId, userId, randomUUID(), createHash('sha256').update(tokenId).digest('hex'), far, far, new Date()],
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    await ds.runMigrations(); // always leave the test database fully migrated
    await ds.query('DELETE FROM users WHERE id = ?', [userId]); // refresh token cascades
    await ds.destroy();
  }
});

describe('AddUserAndCategoryDeactivation migration', () => {
  it('up() adds the columns, the index and the new revoke reason', async () => {
    expect(await column('users', 'deactivatedAt')).toBe('datetime(6)');
    expect(await column('resource_categories', 'deactivatedAt')).toBe('datetime(6)');
    expect(await hasIndex()).toBe(true);
    expect(await column('refresh_tokens', 'revokeReason')).toContain("'deactivated'");
  });

  it('down() removes them and rewrites deactivated revoke reasons to logout_all', async () => {
    await undoThrough(NAME);
    expect(await column('users', 'deactivatedAt')).toBeNull();
    expect(await column('resource_categories', 'deactivatedAt')).toBeNull();
    expect(await hasIndex()).toBe(false);
    expect(await column('refresh_tokens', 'revokeReason')).not.toContain("'deactivated'");

    const [row] = await ds.query('SELECT revokeReason, revokedAt FROM refresh_tokens WHERE id = ?', [tokenId]);
    expect(row.revokeReason).toBe('logout_all');
    expect(row.revokedAt).not.toBeNull(); // still revoked
  });

  it('up() runs again cleanly after down()', async () => {
    await ds.runMigrations();
    expect(await column('users', 'deactivatedAt')).toBe('datetime(6)');
    expect((await executedNewestFirst()).includes(NAME)).toBe(true);
  });
});
