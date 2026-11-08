import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { User } from '../src/users/entities/user.entity.js';
import { plainImage } from './helpers/image-fixtures.js';

// GET /lost-found/mine over the real HTTP stack and real MySQL. It must only ever return the
// caller's own reports and the caller's own claims, without proof details.
// Test app has NO global "api" prefix.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `lfm-${RUN}`;
const PROOF = 'It has a sticker of a cat near the plug and a frayed cable.';

let app: INestApplication;
let ds: DataSource;
let base: string;
let ipCounter = 0;
const userIds: string[] = [];

type Actor = { id: string; token: string; ip: string };
type Photo = { id: string; url: string };
type Report = { id: string; title: string; type: string; status: string; photos: Photo[]; isMine: boolean; [k: string]: unknown };
type ClaimItem = { claim: { id: string; status: string; [k: string]: unknown }; report: Report };
type Mine = { reports: { items: Report[]; truncated: boolean }; claims: { items: ClaimItem[]; truncated: boolean } };

const server = () => app.getHttpServer();
const as = (method: 'get' | 'post' | 'patch', url: string, who?: Actor) => {
  const req = request(server())[method](url).set('X-Forwarded-For', who?.ip ?? '203.0.113.252');
  return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
};
const mine = async (who: Actor) => (await as('get', '/lost-found/mine', who).expect(200)).body as Mine;

async function makeUser(label: string): Promise<Actor> {
  ipCounter += 1;
  const ip = `198.51.102.${ipCounter}`;
  const email = `lfm-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({ name: `lfm-${label}`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), campus: CAMPUS, emailVerifiedAt: new Date() }),
  );
  userIds.push(user.id);
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: PASSWORD }).expect(201);
  return { id: user.id, token: res.body.accessToken as string, ip };
}

async function createReport(who: Actor, type: 'lost' | 'found', title: string): Promise<{ id: string }> {
  const res = await as('post', '/lost-found', who)
    .send({ type, title, description: `${title}, left near the entrance`, category: 'Misc', location: 'Library', itemDate: '2026-10-01' })
    .expect(201);
  return res.body as { id: string };
}

const claim = async (who: Actor, reportId: string) =>
  ((await as('post', `/lost-found/${reportId}/claims`, who).send({ proofDetails: PROOF }).expect(201)).body as { id: string }).id;

/** Bulk-inserts reports straight into the DB (the API's create throttle would make 100+ slow). */
async function seedReports(reporterId: string, count: number, type: 'lost' | 'found' = 'lost'): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  const rows = ids.map(() => `(?, ?, ?, '${type}', 'Seeded item', 'Seeded description', 'Misc', 'Hall', '2026-10-01')`).join(',');
  await ds.query(
    `INSERT INTO lost_found_reports (id, reporterId, campus, type, title, description, category, location, itemDate) VALUES ${rows}`,
    ids.flatMap((id) => [id, reporterId, CAMPUS]),
  );
  return ids;
}

async function seedClaims(claimantId: string, reportIds: string[]) {
  const rows = reportIds.map(() => `(?, ?, ?, ?, ?)`).join(',');
  await ds.query(
    `INSERT INTO lost_found_claims (id, reportId, claimantId, campus, proofDetails) VALUES ${rows}`,
    reportIds.flatMap((reportId) => [randomUUID(), reportId, claimantId, CAMPUS, PROOF]),
  );
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'cl-lost-found-mine-'));
  process.env.UPLOAD_DIR = join(base, 'resources');
  process.env.LOST_FOUND_UPLOAD_DIR = join(base, 'lost-found');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({ send: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  ds = app.get(DataSource);
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized && userIds.length) {
    const marks = userIds.map(() => '?').join(',');
    await ds.query(`DELETE FROM lost_found_reports WHERE reporterId IN (${marks})`, userIds); // claims and photos cascade
    await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, userIds);
    await ds.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
  }
  await app?.close();
  await rm(base, { recursive: true, force: true });
});

describe('GET /lost-found/mine', () => {
  let alice: Actor; // files reports and claims items
  let bob: Actor; // files a report and claims Alice's item
  let finder: Actor; // reports found items Alice claims
  let aliceLost: { id: string };
  let aliceFound: { id: string };
  let bobReport: { id: string };
  let pendingItem: { id: string };
  let approvedItem: { id: string };
  let rejectedItem: { id: string };
  let alicePhoto: Photo;

  beforeAll(async () => {
    alice = await makeUser('alice');
    bob = await makeUser('bob');
    finder = await makeUser('finder');
    const other = await makeUser('other');

    aliceLost = await createReport(alice, 'lost', 'Alice red scarf');
    alicePhoto = (
      await as('post', `/lost-found/${aliceLost.id}/photos`, alice)
        .attach('files', await plainImage('jpeg'), { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201)
    ).body[0] as Photo;
    aliceFound = await createReport(alice, 'found', 'Alice found keys');
    await as('patch', `/lost-found/${aliceLost.id}/resolve`, alice).expect(200); // resolved reports are listed too
    bobReport = await createReport(bob, 'lost', 'Bob blue bottle');
    await claim(bob, aliceFound.id); // someone else's claim on Alice's report

    pendingItem = await createReport(finder, 'found', 'Finder phone');
    approvedItem = await createReport(finder, 'found', 'Finder wallet');
    rejectedItem = await createReport(finder, 'found', 'Finder watch');
    await as('post', `/lost-found/${pendingItem.id}/photos`, finder)
      .attach('files', await plainImage('jpeg'), { filename: 'f.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await claim(alice, pendingItem.id);
    const approvedClaim = await claim(alice, approvedItem.id);
    const rejectedClaim = await claim(alice, rejectedItem.id);
    await claim(other, rejectedItem.id); // another person's claim on the same item
    await as('patch', `/lost-found/claims/${approvedClaim}/review`, finder).send({ status: 'approved' }).expect(200);
    await as('patch', `/lost-found/claims/${rejectedClaim}/review`, finder).send({ status: 'rejected', reviewerNote: 'Wrong colour.' }).expect(200);
  });

  it('is not swallowed by GET /lost-found/:id', async () => {
    const res = await as('get', '/lost-found/mine', alice);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reports');
  });

  it('lists my reports, open and resolved, newest first, with my photos', async () => {
    const { reports } = await mine(alice);
    expect(reports.truncated).toBe(false);
    expect(reports.items.map((r) => r.id)).toEqual([aliceFound.id, aliceLost.id]);
    expect(reports.items.map((r) => r.status)).toEqual(['open', 'resolved']);
    expect(reports.items.every((r) => r.isMine)).toBe(true);
    expect(reports.items[1].photos).toEqual([alicePhoto]);
  });

  it('lists my claims with their status, newest first, without proof details', async () => {
    const { claims } = await mine(alice);
    expect(claims.truncated).toBe(false);
    expect(claims.items.map((c) => c.report.id)).toEqual([rejectedItem.id, approvedItem.id, pendingItem.id]);
    expect(claims.items.map((c) => c.claim.status)).toEqual(['rejected', 'approved', 'pending']);
    expect(claims.items[0].claim.reviewerNote).toBe('Wrong colour.');
    expect(claims.items.map((c) => c.report.status)).toEqual(['open', 'resolved', 'open']);
    for (const item of claims.items) {
      expect(item.claim).not.toHaveProperty('proofDetails');
      expect(item.claim).not.toHaveProperty('claimantId');
      expect(item.report.isMine).toBe(false);
    }
    expect(JSON.stringify(claims)).not.toContain(PROOF);
  });

  it("does not show a claimed found item's photos", async () => {
    const { claims } = await mine(alice);
    expect(claims.items.find((c) => c.report.id === pendingItem.id)!.report.photos).toEqual([]);
  });

  it("user B cannot see user A's reports or claims here", async () => {
    const forBob = await mine(bob);
    expect(forBob.reports.items.map((r) => r.id)).toEqual([bobReport.id]);
    expect(forBob.claims.items.map((c) => c.report.id)).toEqual([aliceFound.id]); // only Bob's own claim
    const all = JSON.stringify(forBob);
    for (const id of [aliceLost.id, pendingItem.id, approvedItem.id, rejectedItem.id]) expect(all).not.toContain(id);
  });

  it("other people's claims on my report never appear in my claims", async () => {
    const { claims } = await mine(alice);
    expect(claims.items.map((c) => c.report.id)).not.toContain(aliceFound.id); // Bob's claim on Alice's report
    const forFinder = await mine(finder);
    expect(forFinder.claims.items).toEqual([]); // Alice's and Other's claims are on Finder's reports, not by Finder
    expect(JSON.stringify(forFinder)).not.toContain(PROOF);
  });

  it('a new user gets two empty lists', async () => {
    const fresh = await makeUser('fresh');
    expect(await mine(fresh)).toEqual({ reports: { items: [], truncated: false }, claims: { items: [], truncated: false } });
  });

  it('not logged in: 401', async () => {
    await as('get', '/lost-found/mine').expect(401);
  });
});

describe('GET /lost-found/mine truncation', () => {
  it('reports: 100 is not truncated; 101 returns the 100 newest with truncated: true', async () => {
    const heavy = await makeUser('heavy-reporter');
    await seedReports(heavy.id, 100);
    let body = await mine(heavy);
    expect(body.reports.items).toHaveLength(100);
    expect(body.reports.truncated).toBe(false);

    await new Promise((r) => setTimeout(r, 5)); // newer createdAt than the seeded rows
    const newest = await createReport(heavy, 'lost', 'Newest of many');
    body = await mine(heavy);
    expect(body.reports.items).toHaveLength(100);
    expect(body.reports.truncated).toBe(true);
    expect(body.reports.items[0].id).toBe(newest.id);
  });

  it('claims: 101 claims return 100 with truncated: true', async () => {
    const owner = await makeUser('heavy-owner');
    const claimant = await makeUser('heavy-claimant');
    const found = await seedReports(owner.id, 101, 'found');
    await seedClaims(claimant.id, found.slice(0, 100));
    let body = await mine(claimant);
    expect(body.claims.items).toHaveLength(100);
    expect(body.claims.truncated).toBe(false);

    await seedClaims(claimant.id, found.slice(100));
    body = await mine(claimant);
    expect(body.claims.items).toHaveLength(100);
    expect(body.claims.truncated).toBe(true);
  });
});
