import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { EXPORT_ROW_LIMIT } from '../src/admin/admin-exports.service.js';

// /admin/exports/*.csv over the real HTTP stack and MySQL: access, headers, columns, formula
// injection escaping, sensitive fields left out, filters, the row cap, and an audit row per export.
// Test app has NO global "api" prefix.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `exp-${RUN}`;
const BIG = `exp-big-${RUN}`;
const NOTE = `private loan note ${RUN}`;

let app: INestApplication;
let ds: DataSource;
let ipCounter = 0;
const userIds: string[] = [];
const categoryIds: string[] = [];

type Actor = { id: string; ip: string; token: string; email: string };

const server = () => app.getHttpServer();
const nextIp = () => `198.51.111.${(++ipCounter % 250) + 1}`;
const get = (url: string, who?: Actor) => {
  const req = request(server())
    .get(url)
    .set('X-Forwarded-For', who?.ip ?? nextIp())
    .buffer(true)
    .parse((res, done) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => done(null, body));
    });
  return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
};

/** Minimal RFC 4180 reader (quoted cells, doubled quotes, embedded commas and newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else {
      cell += ch;
    }
  }
  return rows;
}
const records = (text: string) => {
  const [header, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

async function makeUser(label: string, opts: { role?: UserRole; name?: string; login?: boolean } = {}): Promise<Actor> {
  const email = `exp-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({ name: opts.name ?? `exp-${label}`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), campus: CAMPUS, role: opts.role ?? UserRole.STUDENT, emailVerifiedAt: new Date() }),
  );
  userIds.push(user.id);
  if (opts.login === false) return { id: user.id, ip: '', token: '', email };
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password: PASSWORD }).expect(201);
  return { id: user.id, ip: nextIp(), token: res.body.accessToken, email };
}

const exportAudits = (actorId: string) =>
  ds.query("SELECT action, metadata, ipAddress FROM audit_logs WHERE actorId = ? AND action LIKE 'export.%' ORDER BY createdAt", [actorId]) as Promise<
    Array<{ action: string; metadata: unknown; ipAddress: string | null }>
  >;
const meta = (m: unknown) => (typeof m === 'string' ? JSON.parse(m) : m) as { filters: Record<string, string>; rowCount: number };

let admin: Actor;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({ send: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  ds = app.get(DataSource);
  admin = await makeUser('admin', { role: UserRole.ADMIN });
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await ds.query(`DELETE br FROM borrow_requests br JOIN resources r ON r.id = br.resourceId WHERE r.ownerId IN (${marks})`, userIds);
      await ds.query(`DELETE FROM resources WHERE ownerId IN (${marks})`, userIds);
      await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, userIds);
      await ds.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await ds.query('DELETE FROM users WHERE campus = ?', [BIG]);
    if (categoryIds.length) await ds.query(`DELETE FROM resource_categories WHERE id IN (${categoryIds.map(() => '?').join(',')})`, categoryIds);
  }
  await app?.close();
});

describe('access', () => {
  it('not logged in: 401; students and moderators: 403; none of them is audited', async () => {
    const routes = ['/admin/exports/users.csv', '/admin/exports/loans.csv', '/admin/exports/audit-logs.csv'];
    for (const url of routes) await get(url).expect(401);
    for (const who of [await makeUser('student'), await makeUser('mod', { role: UserRole.MODERATOR })]) {
      for (const url of routes) await get(url, who).expect(403);
      expect(await exportAudits(who.id)).toEqual([]);
    }
  });
});

describe('users.csv', () => {
  const hostile = ['=HYPERLINK("http://evil.example","click")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', 'Ann "Quotes", Jr.\nSecond line'];

  beforeAll(async () => {
    for (const [i, name] of hostile.entries()) await makeUser(`hostile${i}`, { name, login: false });
  });

  it('downloads as an uncached attachment with the admin columns only', async () => {
    const res = await get(`/admin/exports/users.csv?campus=${CAMPUS}`, admin).expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="campusloop-users-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((res.body as string).startsWith('\uFEFF')).toBe(true);

    const [header] = parseCsv(res.body as string);
    expect(header).toEqual(['id', 'name', 'email', 'campus', 'role', 'email_verified_at', 'deactivated_at', 'created_at']);
    expect(res.body as string).not.toMatch(/passwordHash|emailCanonical|\$2[aby]\$/);
  });

  it('escapes every cell that a spreadsheet would run as a formula, and keeps quotes and newlines intact', async () => {
    const rows = records((await get(`/admin/exports/users.csv?campus=${CAMPUS}`, admin).expect(200)).body as string);
    const names = rows.map((r) => r.name);
    expect(names).toContain(`'=HYPERLINK("http://evil.example","click")`);
    expect(names).toContain("'+1+1");
    expect(names).toContain("'-2+3");
    expect(names).toContain("'@SUM(A1)");
    expect(names).toContain("'\t=1");
    expect(names).toContain('Ann "Quotes", Jr.\nSecond line');
    for (const name of names) expect(name).not.toMatch(/^[=+\-@\t\r]/);
  });

  it('applies the same filters as the admin list, and audits the export with filters, row count and IP', async () => {
    const before = (await exportAudits(admin.id)).length;
    const rows = records((await get(`/admin/exports/users.csv?campus=${CAMPUS}&role=admin`, admin).expect(200)).body as string);
    expect(rows.map((r) => r.email)).toEqual([admin.email]);

    const audits = await exportAudits(admin.id);
    expect(audits).toHaveLength(before + 1);
    const last = audits.at(-1)!;
    expect(last.action).toBe('export.users');
    expect(last.ipAddress).toBe(admin.ip);
    expect(meta(last.metadata)).toEqual({ filters: { campus: CAMPUS, role: 'admin' }, rowCount: 1 });
  });

  it('rejects invalid filters, and pagination params, with 400 and no audit row', async () => {
    const before = (await exportAudits(admin.id)).length;
    for (const query of ['role=superuser', 'verified=yes', 'page=1', 'limit=5']) await get(`/admin/exports/users.csv?${query}`, admin).expect(400);
    expect((await exportAudits(admin.id)).length).toBe(before);
  });
});

describe('loans.csv', () => {
  let loanId: string;

  beforeAll(async () => {
    const owner = await makeUser('owner', { login: false });
    const borrower = await makeUser('borrower', { login: false });
    const categoryId = randomUUID();
    categoryIds.push(categoryId);
    await ds.query('INSERT INTO resource_categories (id, name, slug) VALUES (?, ?, ?)', [categoryId, `Exp ${RUN}`, `exp-${RUN}`]);
    const resourceId = randomUUID();
    await ds.query('INSERT INTO resources (id, ownerId, categoryId, title) VALUES (?, ?, ?, ?)', [resourceId, owner.id, categoryId, '=cmd|calc']);
    loanId = randomUUID();
    await ds.query('INSERT INTO borrow_requests (id, resourceId, borrowerId, status, dueDate, message) VALUES (?, ?, ?, ?, ?, ?)', [
      loanId,
      resourceId,
      borrower.id,
      'returned',
      new Date(Date.now() + 86_400_000),
      NOTE,
    ]);
  });

  it('has the loan columns, escapes the title, and leaves the private message out', async () => {
    const res = await get(`/admin/exports/loans.csv?campus=${CAMPUS}`, admin).expect(200);
    const [header] = parseCsv(res.body as string);
    expect(header).toEqual(['id', 'resource_id', 'resource_title', 'category', 'owner_email', 'borrower_email', 'campus', 'status', 'created_at', 'approved_at', 'due_date']);
    const rows = records(res.body as string);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: loanId,
      resource_title: "'=cmd|calc",
      category: `Exp ${RUN}`,
      owner_email: `exp-owner-${RUN}@example.com`,
      borrower_email: `exp-borrower-${RUN}@example.com`,
      campus: CAMPUS,
      status: 'returned',
    });
    expect(res.body as string).not.toContain(NOTE);
    expect((await exportAudits(admin.id)).at(-1)!.action).toBe('export.loans');
  });

  it('filters by status and date', async () => {
    expect(records((await get(`/admin/exports/loans.csv?campus=${CAMPUS}&status=active`, admin).expect(200)).body as string)).toEqual([]);
    expect(records((await get(`/admin/exports/loans.csv?campus=${CAMPUS}&from=2999-01-01`, admin).expect(200)).body as string)).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    expect(records((await get(`/admin/exports/loans.csv?campus=${CAMPUS}&from=${today}&to=${today}`, admin).expect(200)).body as string)).toHaveLength(1);
    await get('/admin/exports/loans.csv?status=lost', admin).expect(400);
    await get('/admin/exports/loans.csv?from=2026-11-02&to=2026-11-01', admin).expect(400);
  });
});

describe('audit-logs.csv', () => {
  it('has no IP address column, and the export of the audit log is itself audited', async () => {
    const res = await get(`/admin/exports/audit-logs.csv?actorId=${admin.id}`, admin).expect(200);
    expect(res.headers['content-disposition']).toMatch(/filename="campusloop-audit-logs-\d{4}-\d{2}-\d{2}\.csv"/);
    const [header] = parseCsv(res.body as string);
    expect(header).toEqual(['id', 'created_at', 'actor_id', 'actor_email', 'action', 'target_type', 'target_id', 'metadata']);
    expect(res.body as string).not.toContain(admin.ip);

    const rows = records(res.body as string);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actor_id === admin.id && r.actor_email === admin.email)).toBe(true);
    expect(rows.map((r) => r.action)).toContain('export.users'); // earlier exports by this admin
    expect(JSON.parse(rows.find((r) => r.action === 'export.users')!.metadata)).toHaveProperty('rowCount');

    expect((await exportAudits(admin.id)).at(-1)!.action).toBe('export.audit_logs');
  });
});

describe('row cap', () => {
  it(`refuses exports over ${EXPORT_ROW_LIMIT} rows with 422 and writes no audit row`, async () => {
    const total = EXPORT_ROW_LIMIT + 1;
    for (let start = 0; start < total; start += 5_000) {
      const chunk = Math.min(5_000, total - start);
      const values: unknown[] = [];
      for (let i = 0; i < chunk; i++) {
        const email = `exp-big-${start + i}-${RUN}@example.com`;
        values.push(randomUUID(), 'exp-big', email, email, 'x', BIG);
      }
      await ds.query(
        `INSERT INTO users (id, name, email, emailCanonical, passwordHash, campus) VALUES ${Array.from({ length: chunk }, () => '(?, ?, ?, ?, ?, ?)').join(',')}`,
        values,
      );
    }

    const before = (await exportAudits(admin.id)).length;
    const res = await get(`/admin/exports/users.csv?campus=${BIG}`, admin).expect(422);
    expect(JSON.parse(res.body as string).message).toBe(
      `This export would have ${total} rows; the limit is ${EXPORT_ROW_LIMIT}. Narrow the filters and try again.`,
    );
    expect((await exportAudits(admin.id)).length).toBe(before);

    // Exactly at the limit is allowed.
    await ds.query('DELETE FROM users WHERE campus = ? LIMIT 1', [BIG]);
    const ok = await get(`/admin/exports/users.csv?campus=${BIG}`, admin).expect(200);
    expect(parseCsv(ok.body as string)).toHaveLength(EXPORT_ROW_LIMIT + 1); // header + rows
    expect(meta((await exportAudits(admin.id)).at(-1)!.metadata).rowCount).toBe(EXPORT_ROW_LIMIT);
  }, 180_000);
});
