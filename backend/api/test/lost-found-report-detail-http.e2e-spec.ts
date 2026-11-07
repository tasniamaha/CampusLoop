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
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { plainImage } from './helpers/image-fixtures.js';

// GET /lost-found/:id over the real HTTP stack and real MySQL: canViewReport for the report itself,
// canViewPhotos for its photos, and `myClaim` for claimants. Test app has NO global "api" prefix.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `lfd-north-${RUN}`;
const OTHER_CAMPUS = `lfd-south-${RUN}`;
const PROOF = 'It has a sticker of a cat near the plug and a frayed cable.';

let app: INestApplication;
let ds: DataSource;
let base: string;
let ipCounter = 0;
const userIds: string[] = [];

type Actor = { id: string; token: string; ip: string };
type Photo = { id: string; url: string };
type Claim = { id: string; status: string; reviewerNote: string | null; [key: string]: unknown };
type Detail = {
  id: string;
  type: string;
  status: string;
  imageUrl: string | null;
  photos: Photo[];
  isMine: boolean;
  myClaim: Claim | null;
};

const server = () => app.getHttpServer();
const as = (method: 'get' | 'post' | 'patch', url: string, who?: Actor) => {
  const req = request(server())[method](url).set('X-Forwarded-For', who?.ip ?? '203.0.113.251');
  return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
};
const detail = (id: string, who?: Actor) => as('get', `/lost-found/${id}`, who);

async function makeUser(label: string, opts: { role?: UserRole; campus?: string } = {}): Promise<Actor> {
  ipCounter += 1;
  const ip = `198.51.101.${ipCounter}`;
  const email = `lfd-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({
      name: `lfd-${label}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: opts.role ?? UserRole.STUDENT,
      campus: opts.campus ?? CAMPUS,
      emailVerifiedAt: new Date(),
    }),
  );
  userIds.push(user.id);
  const res = await request(server()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: PASSWORD }).expect(201);
  return { id: user.id, token: res.body.accessToken as string, ip };
}

async function createReport(who: Actor, type: 'lost' | 'found', title: string): Promise<{ id: string }> {
  const res = await as('post', '/lost-found', who)
    .send({ type, title, description: `${title}, left near the entrance`, category: 'Electronics', location: 'Library', itemDate: '2026-10-01' })
    .expect(201);
  return res.body as { id: string };
}

async function addPhoto(who: Actor, reportId: string): Promise<Photo> {
  const res = await as('post', `/lost-found/${reportId}/photos`, who)
    .attach('files', await plainImage('jpeg'), { filename: 'p.jpg', contentType: 'image/jpeg' })
    .expect(201);
  return (res.body as Photo[])[0];
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'cl-lost-found-detail-'));
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
    await ds.query(`DELETE FROM lost_found_reports WHERE reporterId IN (${marks})`, userIds);
    await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, userIds);
    await ds.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
  }
  await app?.close();
  await rm(base, { recursive: true, force: true });
});

describe('GET /lost-found/:id', () => {
  let finder: Actor;
  let winner: Actor; // claim approved
  let loser: Actor; // claim auto-rejected when the other one is approved
  let bystander: Actor; // same campus, never claimed
  let otherCampus: Actor;
  let moderator: Actor;
  let otherModerator: Actor;
  let admin: Actor;
  let found: { id: string };
  let lost: { id: string };
  let foundPhoto: Photo;
  let lostPhoto: Photo;
  let winnerClaimId: string;

  beforeAll(async () => {
    finder = await makeUser('finder');
    winner = await makeUser('winner');
    loser = await makeUser('loser');
    bystander = await makeUser('bystander');
    otherCampus = await makeUser('other', { campus: OTHER_CAMPUS });
    moderator = await makeUser('mod', { role: UserRole.MODERATOR });
    otherModerator = await makeUser('mod2', { role: UserRole.MODERATOR, campus: OTHER_CAMPUS });
    admin = await makeUser('admin', { role: UserRole.ADMIN, campus: OTHER_CAMPUS });

    found = await createReport(finder, 'found', 'Grey laptop charger');
    lost = await createReport(bystander, 'lost', 'Blue umbrella');
    foundPhoto = await addPhoto(finder, found.id);
    lostPhoto = await addPhoto(bystander, lost.id);

    const claim = await as('post', `/lost-found/${found.id}/claims`, winner).send({ proofDetails: PROOF }).expect(201);
    winnerClaimId = claim.body.id as string;
    await as('post', `/lost-found/${found.id}/claims`, loser).send({ proofDetails: `${PROOF} Also scratched.` }).expect(201);
  });

  describe('while open', () => {
    it('reporter: full report, own photos, isMine, no myClaim', async () => {
      const body = (await detail(found.id, finder).expect(200)).body as Detail;
      expect(body).toMatchObject({ id: found.id, type: 'found', status: 'open', isMine: true, myClaim: null });
      expect(body.photos).toEqual([foundPhoto]);
    });

    it('same-campus student: found report without its photos', async () => {
      const body = (await detail(found.id, bystander).expect(200)).body as Detail;
      expect(body).toMatchObject({ isMine: false, myClaim: null, imageUrl: null });
      expect(body.photos).toEqual([]);
    });

    it('same-campus student: lost report with its photos', async () => {
      const body = (await detail(lost.id, winner).expect(200)).body as Detail;
      expect(body.photos).toEqual([lostPhoto]);
    });

    it('claimant: sees their own pending claim, without private details or other claims', async () => {
      const body = (await detail(found.id, winner).expect(200)).body as Detail;
      expect(body.photos).toEqual([]);
      expect(body.myClaim).toMatchObject({ id: winnerClaimId, status: 'pending', reviewerNote: null });
      expect(body.myClaim).not.toHaveProperty('proofDetails');
      expect(body.myClaim).not.toHaveProperty('claimantId');
    });

    it('other campus: 404 for students and moderators; admin: 200', async () => {
      await detail(found.id, otherCampus).expect(404);
      await detail(found.id, otherModerator).expect(404);
      const body = (await detail(found.id, admin).expect(200)).body as Detail;
      expect(body.photos).toEqual([foundPhoto]);
    });

    it('same-campus moderator: report and photos', async () => {
      const body = (await detail(found.id, moderator).expect(200)).body as Detail;
      expect(body.photos).toEqual([foundPhoto]);
    });
  });

  describe('after resolution', () => {
    beforeAll(async () => {
      await as('patch', `/lost-found/claims/${winnerClaimId}/review`, finder)
        .send({ status: 'approved', reviewerNote: 'Pick it up at the library desk.' })
        .expect(200);
    });

    it('claimant (approved): report and their claim status, still no photos', async () => {
      const body = (await detail(found.id, winner).expect(200)).body as Detail;
      expect(body.status).toBe('resolved');
      expect(body.myClaim).toMatchObject({ id: winnerClaimId, status: 'approved', reviewerNote: 'Pick it up at the library desk.' });
      expect(body.photos).toEqual([]);
      expect(body.imageUrl).toBeNull();
    });

    it('claimant (rejected by the approval): can still see the outcome', async () => {
      const body = (await detail(found.id, loser).expect(200)).body as Detail;
      expect(body.myClaim?.status).toBe('rejected');
      expect(body.photos).toEqual([]);
    });

    it('non-claimant on the same campus: 404', async () => {
      await detail(found.id, bystander).expect(404);
    });

    it('reporter, same-campus moderator and admin: 200 with photos; other-campus moderator: 404', async () => {
      for (const who of [finder, moderator, admin]) {
        const body = (await detail(found.id, who).expect(200)).body as Detail;
        expect(body.photos).toEqual([foundPhoto]);
      }
      await detail(found.id, otherModerator).expect(404);
    });

    it('a resolved lost report is hidden from everyone else on the campus', async () => {
      await as('patch', `/lost-found/${lost.id}/resolve`, bystander).expect(200);
      await detail(lost.id, winner).expect(404);
      const own = (await detail(lost.id, bystander).expect(200)).body as Detail;
      expect(own.photos).toEqual([lostPhoto]);
    });
  });

  describe('bad requests', () => {
    it('not logged in: 401', async () => {
      await detail(found.id).expect(401);
    });

    it('malformed id: 400; unknown id: 404', async () => {
      await detail('not-a-uuid', finder).expect(400);
      await detail(randomUUID(), finder).expect(404);
    });
  });
});
