import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { AdminUsersService } from '../src/admin/admin-users.service.js';
import { timedStep } from './helpers/timed-step.js';

// The admin:promote bootstrap path against the real test database: the service rules it shares
// with the admin API, and the compiled CLI itself (dist/, built by `npm run build` before tests).

const RUN = randomUUID().slice(0, 8);
const CAMPUS = `cli-${RUN}`;
const CLI = join(import.meta.dirname, '..', 'dist', 'scripts', 'admin-promote.js');
const run = promisify(execFile);
const SPEC = 'admin-promote-cli';
// These limits cover slow process startup on Windows dev machines, not a hang: each call starts a
// fresh node process, measured at 2 to 8 s just to load the CLI. A CLI still running after
// CLI_TIMEOUT_MS is killed and the test fails with its output so far. One test calls it 3 times,
// hence CLI_TEST_TIMEOUT_MS for that describe.
const CLI_TIMEOUT_MS = 25_000;
const CLI_TEST_TIMEOUT_MS = 90_000;

let app: INestApplication;
let ds: DataSource;
let service: AdminUsersService;
const userIds: string[] = [];

const emailFor = (label: string) => `cli-${label}-${RUN}@example.com`;

async function makeUser(label: string, opts: { role?: UserRole; verified?: boolean; deactivated?: boolean } = {}) {
  const repo = ds.getRepository(User);
  const user = await timedStep(SPEC, `makeUser ${label}`, async () => repo.save(
    repo.create({
      name: `cli-${label}`,
      email: emailFor(label),
      passwordHash: await bcrypt.hash('correct-horse-battery', 4),
      campus: CAMPUS,
      role: opts.role ?? UserRole.STUDENT,
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      deactivatedAt: opts.deactivated ? new Date() : null,
    }),
  ));
  userIds.push(user.id);
  return user;
}

const roleOf = async (id: string) => ((await ds.query('SELECT role FROM users WHERE id = ?', [id])) as Array<{ role: string }>)[0].role;
const auditRows = (id: string) =>
  ds.query('SELECT actorId, action, metadata, ipAddress FROM audit_logs WHERE targetId = ?', [id]) as Promise<
    Array<{ actorId: string | null; action: string; metadata: unknown; ipAddress: string | null }>
  >;
const meta = (m: unknown) => (typeof m === 'string' ? JSON.parse(m) : m);

/** Runs the compiled CLI with ONLY the variables given (plus PATH/SystemRoot so node can start). */
async function cli(args: string[], env: Record<string, string>) {
  const base = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
  return timedStep(SPEC, `cli ${JSON.stringify(args)}`, async () => {
    try {
      const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
        env: { ...base, ...env },
        cwd: join(import.meta.dirname, '..'),
        timeout: CLI_TIMEOUT_MS,
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code: number | null; killed?: boolean; signal?: string | null; stdout: string; stderr: string };
      if (e.killed) {
        throw new Error(
          `admin-promote CLI did not exit within ${CLI_TIMEOUT_MS} ms (killed with ${e.signal}). stdout so far: ${JSON.stringify(e.stdout)}; stderr so far: ${JSON.stringify(e.stderr)}`,
        );
      }
      return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  });
}

/** Every DB variable set explicitly to the TEST database, so .env can never fill one in. */
const testDbEnv = () => ({
  DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.TEST_DB_PORT ?? '3317',
  DB_USERNAME: process.env.TEST_DB_USER ?? 'root',
  DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? 'root',
  DB_DATABASE: process.env.TEST_DB_NAME ?? 'campusloop_test',
});

beforeAll(async () => {
  const moduleRef = await timedStep(SPEC, 'compile AppModule', () =>
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async () => undefined })
      .compile(),
  );
  app = moduleRef.createNestApplication();
  await timedStep(SPEC, 'app.init (connects, runs pending migrations)', () => app.init());
  ds = app.get(DataSource);
  service = app.get(AdminUsersService);
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized && userIds.length) {
    const marks = userIds.map(() => '?').join(',');
    await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, userIds);
    await ds.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
  }
  await app?.close();
});

describe('promoteBySystem (shared with the admin API rules)', () => {
  it('promotes a verified, active student and audits it with the system actor', async () => {
    const user = await makeUser('ok');
    const view = await service.promoteBySystem(emailFor('ok'));
    expect(view).toMatchObject({ id: user.id, role: 'admin' });

    const rows = await auditRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, action: 'user.role_changed', ipAddress: null });
    expect(meta(rows[0].metadata)).toEqual({ from: 'student', to: 'admin', actor: 'system', via: 'cli' });
  });

  it('finds the account by canonical email (case and surrounding spaces ignored)', async () => {
    const user = await makeUser('canon');
    await service.promoteBySystem(`  ${emailFor('canon').toUpperCase()} `);
    expect(await roleOf(user.id)).toBe('admin');
  });

  it('refuses unknown, unverified, deactivated and already-admin accounts, changing nothing', async () => {
    await expect(service.promoteBySystem(emailFor('nobody'))).rejects.toThrow('No account uses this email address');

    const cases = [
      { label: 'unverified', opts: { verified: false }, message: 'This account has not verified its email address yet' },
      { label: 'deactivated', opts: { deactivated: true }, message: 'This account is deactivated; reactivate it before promoting it' },
      { label: 'already', opts: { role: UserRole.ADMIN }, message: 'This account is already an admin' },
    ];
    for (const { label, opts, message } of cases) {
      const user = await makeUser(label, opts);
      const before = await roleOf(user.id);
      await expect(service.promoteBySystem(emailFor(label))).rejects.toThrow(message);
      expect(await roleOf(user.id)).toBe(before);
      expect(await auditRows(user.id)).toEqual([]);
    }
  });
});

describe('npm run admin:promote (compiled CLI)', { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  beforeAll(() => {
    if (!existsSync(CLI)) throw new Error(`${CLI} is missing: run "npm run build" before the e2e tests`);
  });

  it('refuses to run without an explicit DB_DATABASE, even though .env defines one', async () => {
    const user = await makeUser('no-db');
    const { DB_DATABASE: _omitted, ...withoutDatabase } = testDbEnv();
    const res = await cli([emailFor('no-db')], withoutDatabase);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Refusing to run: set DB_DATABASE explicitly');
    expect(res.stdout).not.toContain('About to change database');
    expect(await roleOf(user.id)).toBe('student');
  });

  it('prints the target database first, then promotes', async () => {
    const user = await makeUser('cli-ok');
    const res = await cli(['--', emailFor('cli-ok')], testDbEnv());
    expect(res.code).toBe(0);
    const lines = res.stdout.trim().split(/\r?\n/);
    expect(lines[0]).toBe(`About to change database "${testDbEnv().DB_DATABASE}" on ${testDbEnv().DB_HOST}:${testDbEnv().DB_PORT}`);
    expect(lines[1]).toContain(`Promoted ${emailFor('cli-ok')}`);
    expect(await roleOf(user.id)).toBe('admin');
  });

  it('exits 1 with the reason for a refused account, and 2 for bad usage', async () => {
    const res = await cli([emailFor('cli-nobody')], testDbEnv());
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Not promoted: No account uses this email address');

    expect((await cli([], testDbEnv())).code).toBe(2);
    expect((await cli(['not-an-email'], testDbEnv())).stderr).toContain('Usage: npm run admin:promote -- <email>');
  });
});
