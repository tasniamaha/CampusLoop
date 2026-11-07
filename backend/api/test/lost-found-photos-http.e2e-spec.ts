import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { containsAnyMarker, hasGpsPointer, imageWithMetadata, plainImage } from './helpers/image-fixtures.js';

// Real HTTP stack (JWT, verified-email, throttler, ValidationPipe, multer) against real MySQL and
// real image folders. Test app has NO global "api" prefix; photo URLs in responses start with /api.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `lfp-north-${RUN}`; // unique per run: list endpoints are campus-scoped
const OTHER_CAMPUS = `lfp-south-${RUN}`;
const TYPE_ERROR = 'File #1 is not a supported image. Please use JPG, PNG or WebP.';

let app: INestApplication;
let ds: DataSource;
let base: string;
let lostFoundDir: string;
let resourcesDir: string;
let ipCounter = 0;
const userIds: string[] = [];

type Actor = { id: string; token: string; ip: string };
type Photo = { id: string; url: string };
type ReportBody = { id: string; type: string; imageUrl: string | null; photos: Photo[]; isMine?: boolean };

const server = () => app.getHttpServer();
const path = (url: string) => url.replace(/^\/api/, '');
const as = (method: 'get' | 'post' | 'patch' | 'delete', url: string, who?: Actor) => {
  const req = request(server())[method](url).set('X-Forwarded-For', who?.ip ?? '203.0.113.250');
  return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
};
const filesIn = async (dir: string) => (existsSync(dir) ? (await readdir(dir)).length : 0);

async function makeUser(label: string, opts: { role?: UserRole; campus?: string; verified?: boolean } = {}): Promise<Actor> {
  ipCounter += 1;
  const ip = `198.51.100.${ipCounter}`; // one IP per user: login throttles never interfere
  const email = `lfp-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({
      name: `lfp-${label}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: opts.role ?? UserRole.STUDENT,
      campus: opts.campus ?? CAMPUS,
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    }),
  );
  userIds.push(user.id);
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: PASSWORD }).expect(201);
  return { id: user.id, token: res.body.accessToken as string, ip };
}

async function createReport(who: Actor, type: 'lost' | 'found', title = 'Blue water bottle'): Promise<ReportBody> {
  const res = await as('post', '/lost-found', who)
    .send({ type, title, description: `${title} with a dented lid`, category: 'Bottle', location: 'Library', itemDate: '2026-10-01' })
    .expect(201);
  return res.body as ReportBody;
}

function upload(who: Actor | undefined, reportId: string, files: Array<{ buf: Buffer; name: string; type: string }>) {
  let req = as('post', `/lost-found/${reportId}/photos`, who);
  for (const f of files) req = req.attach('files', f.buf, { filename: f.name, contentType: f.type });
  return req;
}

const jpeg = async () => ({ buf: await plainImage('jpeg'), name: 'photo.jpg', type: 'image/jpeg' });

async function listFor(who: Actor): Promise<ReportBody[]> {
  const res = await as('get', '/lost-found?limit=50', who).expect(200);
  return res.body.data as ReportBody[];
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'cl-lost-found-photos-'));
  resourcesDir = join(base, 'resources');
  lostFoundDir = join(base, 'lost-found');
  process.env.UPLOAD_DIR = resourcesDir;
  process.env.LOST_FOUND_UPLOAD_DIR = lostFoundDir;

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
    // Photos and claims cascade from reports.
    await ds.query(`DELETE FROM lost_found_reports WHERE reporterId IN (${userIds.map(() => '?').join(',')})`, userIds);
    await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${userIds.map(() => '?').join(',')})`, userIds);
    await ds.query(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
  }
  await app?.close();
  await rm(base, { recursive: true, force: true });
});

describe('upload', () => {
  let owner: Actor;
  let report: ReportBody;

  beforeAll(async () => {
    owner = await makeUser('uploader');
    report = await createReport(owner, 'lost');
  });

  it('stores a photo without EXIF/GPS, upright, in the lost-found folder only', async () => {
    const input = await imageWithMetadata('jpeg');
    expect(hasGpsPointer((await sharp(input).metadata()).exif)).toBe(true); // fixture really has GPS

    const res = await upload(owner, report.id, [{ buf: input, name: 'phone.jpg', type: 'image/jpeg' }]).expect(201);
    const [photo] = res.body as Photo[];
    expect(photo.url).toBe(`/api/lost-found/${report.id}/photos/${photo.id}`);

    const [row] = await ds.query('SELECT storageKey, mimeType, sizeBytes FROM lost_found_photos WHERE id = ?', [photo.id]);
    const stored = await readFile(join(lostFoundDir, row.storageKey));
    expect(existsSync(join(resourcesDir, row.storageKey))).toBe(false);
    expect(row.mimeType).toBe('image/jpeg');
    expect(Number(row.sizeBytes)).toBe(stored.length);

    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(containsAnyMarker(stored)).toBe(false);

    const served = await as('get', path(photo.url), owner).expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toBe('private, no-store');
    expect(containsAnyMarker(served.body as Buffer)).toBe(false);
    expect((await sharp(served.body as Buffer).metadata()).exif).toBeUndefined();

    const mine = (await listFor(owner)).find((r) => r.id === report.id)!;
    expect(mine.photos).toEqual([photo]);
  });

  it('rejects wrong types with the JPG/PNG/WebP message and stores nothing', async () => {
    const before = await filesIn(lostFoundDir);
    for (const f of [
      { buf: await plainImage('gif'), name: 'a.gif', type: 'image/gif' },
      { buf: Buffer.from('definitely not an image'), name: 'fake.jpg', type: 'image/jpeg' },
      { buf: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), name: 'x.svg', type: 'image/svg+xml' },
    ]) {
      const res = await upload(owner, report.id, [f]).expect(400);
      expect(res.body.message, f.name).toBe(TYPE_ERROR);
    }
    expect(await filesIn(lostFoundDir)).toBe(before);
  });

  it('rejects a file over 5 MB with 413', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]);
    const before = await filesIn(lostFoundDir);
    await upload(owner, report.id, [{ buf: big, name: 'big.jpg', type: 'image/jpeg' }]).expect(413);
    expect(await filesIn(lostFoundDir)).toBe(before);
  });

  it('caps a report at 5 photos and cleans up the files of a rejected upload', async () => {
    const [{ n: start }] = await ds.query('SELECT COUNT(*) AS n FROM lost_found_photos WHERE reportId = ?', [report.id]);
    const room = 5 - Number(start);
    await upload(owner, report.id, await Promise.all(Array.from({ length: room }, jpeg))).expect(201);

    // These files are written to disk before the capped insert fails; they must be deleted again.
    const before = await filesIn(lostFoundDir);
    const res = await upload(owner, report.id, [await jpeg()]).expect(409);
    expect(res.body.message).toBe('A report can have at most 5 photos');
    expect(await filesIn(lostFoundDir)).toBe(before);

    // More files in one request than the cap: rejected by the upload limits before any processing.
    const other = await createReport(owner, 'lost', 'Green umbrella');
    await upload(owner, other.id, await Promise.all(Array.from({ length: 6 }, jpeg))).expect(400);
    expect((await ds.query('SELECT id FROM lost_found_photos WHERE reportId = ?', [other.id])).length).toBe(0);
  });

  it('keeps the cap exact under concurrent uploads (row lock)', async () => {
    const racer = await makeUser('racer');
    const target = await createReport(racer, 'lost', 'Red scarf');
    await upload(racer, target.id, await Promise.all(Array.from({ length: 3 }, jpeg))).expect(201);
    const before = await filesIn(lostFoundDir);

    const results = await Promise.all(Array.from({ length: 4 }, async () => (await upload(racer, target.id, [await jpeg()])).status));
    expect(results.filter((s) => s === 201)).toHaveLength(2);
    expect(results.filter((s) => s === 409)).toHaveLength(2);

    const rows = await ds.query('SELECT storageKey FROM lost_found_photos WHERE reportId = ?', [target.id]);
    expect(rows).toHaveLength(5);
    // Only the two accepted files were added; the losers' files were removed.
    expect(await filesIn(lostFoundDir)).toBe(before + 2);
  });

  it('only accepts photos for open reports', async () => {
    const closed = await createReport(owner, 'lost', 'Old notebook');
    await as('patch', `/lost-found/${closed.id}/resolve`, owner).expect(200);
    const res = await upload(owner, closed.id, [await jpeg()]).expect(409);
    expect(res.body.message).toBe('Photos can only be added to open reports');
  });

  it('no longer accepts imageUrl on create', async () => {
    await as('post', '/lost-found', owner)
      .send({ type: 'lost', title: 'Keys', description: 'Keys on a ring', category: 'Keys', location: 'Gym', itemDate: '2026-10-01', imageUrl: 'https://example.com/k.jpg' })
      .expect(400);
  });
});

describe('ownership and authentication', () => {
  let owner: Actor;
  let stranger: Actor;
  let report: ReportBody;
  let photo: Photo;

  beforeAll(async () => {
    owner = await makeUser('own-owner');
    stranger = await makeUser('own-stranger');
    report = await createReport(owner, 'lost', 'Black wallet');
    [photo] = (await upload(owner, report.id, [await jpeg()]).expect(201)).body as Photo[];
  });

  it('rejects unauthenticated upload, view and delete with 401', async () => {
    await upload(undefined, report.id, [await jpeg()]).expect(401);
    await as('get', path(photo.url)).expect(401);
    await as('delete', path(photo.url)).expect(401);
  });

  it('rejects upload by an unverified account with 403', async () => {
    const unverified = await makeUser('own-unverified', { verified: false });
    await upload(unverified, report.id, [await jpeg()]).expect(403);
  });

  it("does not let someone else add to or delete from the owner's report", async () => {
    await upload(stranger, report.id, [await jpeg()]).expect(404);
    await as('delete', path(photo.url), stranger).expect(404);
    await as('get', path(photo.url), owner).expect(200); // still there
  });

  it('deleting a photo deletes its row and its file', async () => {
    const [row] = await ds.query('SELECT storageKey FROM lost_found_photos WHERE id = ?', [photo.id]);
    expect(existsSync(join(lostFoundDir, row.storageKey))).toBe(true);

    const res = await as('delete', path(photo.url), owner).expect(200);
    expect(res.body).toEqual({ deleted: true });
    expect(await ds.query('SELECT id FROM lost_found_photos WHERE id = ?', [photo.id])).toHaveLength(0);
    expect(existsSync(join(lostFoundDir, row.storageKey))).toBe(false);
    await as('get', path(photo.url), owner).expect(404);
  });

  it('the public resource image endpoint cannot serve a lost-found photo', async () => {
    const [p] = (await upload(owner, report.id, [await jpeg()]).expect(201)).body as Photo[];
    const [row] = await ds.query('SELECT storageKey FROM lost_found_photos WHERE id = ?', [p.id]);
    await request(server()).get(`/resources/images/${row.storageKey}`).expect(404);
  });

  it('report deletion: photo rows cascade, files stay until a retention policy exists', async () => {
    const doomed = await createReport(owner, 'lost', 'Doomed hat');
    const [p] = (await upload(owner, doomed.id, [await jpeg()]).expect(201)).body as Photo[];
    const [row] = await ds.query('SELECT storageKey FROM lost_found_photos WHERE id = ?', [p.id]);

    await ds.query('DELETE FROM lost_found_reports WHERE id = ?', [doomed.id]); // no API path deletes reports
    expect(await ds.query('SELECT id FROM lost_found_photos WHERE id = ?', [p.id])).toHaveLength(0);
    expect(existsSync(join(lostFoundDir, row.storageKey))).toBe(true); // documented: see LostFoundPhoto
  });
});

describe('visibility (canViewPhotos)', () => {
  let finder: Actor; // reported a FOUND item
  let loser: Actor; // reported a LOST item
  let student: Actor;
  let claimant: Actor;
  let otherCampus: Actor;
  let moderator: Actor;
  let otherModerator: Actor;
  let admin: Actor;
  let found: ReportBody;
  let lost: ReportBody;
  let foundPhoto: Photo;
  let lostPhoto: Photo;

  beforeAll(async () => {
    finder = await makeUser('vis-finder');
    loser = await makeUser('vis-loser');
    student = await makeUser('vis-student');
    claimant = await makeUser('vis-claimant');
    otherCampus = await makeUser('vis-other', { campus: OTHER_CAMPUS });
    moderator = await makeUser('vis-mod', { role: UserRole.MODERATOR });
    otherModerator = await makeUser('vis-mod2', { role: UserRole.MODERATOR, campus: OTHER_CAMPUS });
    admin = await makeUser('vis-admin', { role: UserRole.ADMIN, campus: OTHER_CAMPUS });

    // Same words, place and date: each is a strong match candidate for the other.
    found = await createReport(finder, 'found', 'Silver laptop charger');
    lost = await createReport(loser, 'lost', 'Silver laptop charger');
    [foundPhoto] = (await upload(finder, found.id, [await jpeg()]).expect(201)).body as Photo[];
    [lostPhoto] = (await upload(loser, lost.id, [await jpeg()]).expect(201)).body as Photo[];
    await as('post', `/lost-found/${found.id}/claims`, claimant)
      .send({ proofDetails: 'It has a sticker of a cat near the plug and a frayed cable.' })
      .expect(201);
  });

  it('FOUND photo: finder, same-campus moderator and admin only', async () => {
    const url = path(foundPhoto.url);
    await as('get', url, finder).expect(200);
    await as('get', url, moderator).expect(200);
    await as('get', url, admin).expect(200);
    await as('get', url, student).expect(404);
    await as('get', url, claimant).expect(404);
    await as('get', url, loser).expect(404);
    await as('get', url, otherCampus).expect(404);
    await as('get', url, otherModerator).expect(404);
  });

  it('FOUND report in the list: photos withheld from others without revealing they exist', async () => {
    const forStudent = (await listFor(student)).find((r) => r.id === found.id)!;
    expect(forStudent.photos).toEqual([]);
    expect(forStudent.imageUrl).toBeNull();
    const forClaimant = (await listFor(claimant)).find((r) => r.id === found.id)!;
    expect(forClaimant.photos).toEqual([]);
    const forModerator = (await listFor(moderator)).find((r) => r.id === found.id)!;
    expect(forModerator.photos).toEqual([foundPhoto]);
  });

  it('LOST photo: everyone on the campus, nobody on another campus', async () => {
    const url = path(lostPhoto.url);
    await as('get', url, student).expect(200);
    await as('get', url, claimant).expect(200);
    await as('get', url, finder).expect(200);
    await as('get', url, otherCampus).expect(404);
    expect((await listFor(student)).find((r) => r.id === lost.id)!.photos).toEqual([lostPhoto]);
  });

  it('/matches applies canViewPhotos to every candidate', async () => {
    // The owner of the LOST report sees the FOUND candidate, but not its photos.
    const forLoser = await as('get', `/lost-found/${lost.id}/matches`, loser).expect(200);
    const foundMatch = (forLoser.body as Array<{ report: ReportBody }>).find((m) => m.report.id === found.id);
    expect(foundMatch).toBeDefined();
    expect(foundMatch!.report.photos).toEqual([]);
    expect(foundMatch!.report.imageUrl).toBeNull();

    // The finder sees the LOST candidate with its photos.
    const forFinder = await as('get', `/lost-found/${found.id}/matches`, finder).expect(200);
    const lostMatch = (forFinder.body as Array<{ report: ReportBody }>).find((m) => m.report.id === lost.id);
    expect(lostMatch!.report.photos).toEqual([lostPhoto]);
  });

  it('legacy imageUrl follows the same rule', async () => {
    await ds.query('UPDATE lost_found_reports SET imageUrl = ? WHERE id = ?', ['https://example.com/legacy.jpg', found.id]);
    expect((await listFor(student)).find((r) => r.id === found.id)!.imageUrl).toBeNull();
    expect((await listFor(finder)).find((r) => r.id === found.id)!.imageUrl).toBe('https://example.com/legacy.jpg');
  });

  it('resolved report: photos only for the reporter and moderators', async () => {
    await as('patch', `/lost-found/${lost.id}/resolve`, loser).expect(200);
    const url = path(lostPhoto.url);
    await as('get', url, student).expect(404);
    await as('get', url, finder).expect(404);
    await as('get', url, loser).expect(200);
    await as('get', url, moderator).expect(200);
    await as('get', url, admin).expect(200);
    await as('get', url, otherModerator).expect(404);
  });

  it('a photo id under the wrong report is not found', async () => {
    await as('get', `/lost-found/${lost.id}/photos/${foundPhoto.id}`, moderator).expect(404);
  });
});

describe('rate limit', () => {
  it('limits photo uploads to 10 per minute per user', async () => {
    const busy = await makeUser('rate');
    const report = await createReport(busy, 'lost', 'Rate-limited mug');
    for (let i = 0; i < 10; i++) {
      // Empty uploads are cheap but still count toward the limit.
      await as('post', `/lost-found/${report.id}/photos`, busy).expect(400);
    }
    await as('post', `/lost-found/${report.id}/photos`, busy).expect(429);

    // Per user, not global: someone else can still upload.
    const other = await makeUser('rate-other');
    const theirs = await createReport(other, 'lost', 'Unaffected mug');
    await upload(other, theirs.id, [await jpeg()]).expect(201);
  });
});
