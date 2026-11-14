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

// Colour, brand and the item time window on lost-and-found reports, over the real HTTP stack and
// real MySQL: validation on create, and the fields in every report response. Test app has NO
// global "api" prefix.

const PASSWORD = 'correct-horse-battery';
const RUN = randomUUID().slice(0, 8);
const CAMPUS = `lfa-north-${RUN}`;

let app: INestApplication;
let ds: DataSource;
let ipCounter = 0;
const userIds: string[] = [];

type Actor = { id: string; token: string; ip: string };
type ReportBody = { id: string; itemDate: string; itemDateTo: string | null; color: string | null; brand: string | null };

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const as = (method: 'get' | 'post', url: string, who?: Actor) => {
  const req = request(app.getHttpServer())[method](url).set('X-Forwarded-For', who?.ip ?? '203.0.113.252');
  return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
};
const report = (type: 'lost' | 'found', extra: object = {}) => ({
  type, title: 'Blue steel bottle', description: 'Steel water bottle with a dent', category: 'Bottle',
  location: 'Central Library', itemDate: day(-3), ...extra,
});

async function makeUser(label: string): Promise<Actor> {
  ipCounter += 1;
  const ip = `198.51.102.${ipCounter}`;
  const email = `lfa-${label}-${RUN}@example.com`;
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({
      name: `lfa-${label}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: UserRole.STUDENT,
      campus: CAMPUS,
      emailVerifiedAt: new Date(),
    }),
  );
  userIds.push(user.id);
  const res = await request(app.getHttpServer()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: PASSWORD }).expect(201);
  return { id: user.id, token: res.body.accessToken as string, ip };
}

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
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized && userIds.length) {
    const marks = userIds.map(() => '?').join(',');
    await ds.query(`DELETE FROM lost_found_reports WHERE reporterId IN (${marks})`, userIds);
    await ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, userIds);
    await ds.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
  }
  await app?.close();
});

describe('lost-and-found report attributes', () => {
  let owner: Actor;
  let finder: Actor;
  let lost: ReportBody;
  let found: ReportBody;

  beforeAll(async () => {
    owner = await makeUser('owner');
    finder = await makeUser('finder');
    lost = (await as('post', '/lost-found', owner)
      .send(report('lost', { itemDate: day(-4), itemDateTo: day(-2), color: 'Blue', brand: '  Milton ' }))
      .expect(201)).body as ReportBody;
    found = (await as('post', '/lost-found', finder).send(report('found', { color: 'blue' })).expect(201)).body as ReportBody;
  });

  it('stores and returns colour, brand and the window on create', () => {
    expect(lost).toMatchObject({ itemDate: day(-4), itemDateTo: day(-2), color: 'blue', brand: 'Milton' });
    expect(found).toMatchObject({ itemDateTo: null, color: 'blue', brand: null });
  });

  it('returns them on the detail page, in the list, in my reports and in matches', async () => {
    const detail = (await as('get', `/lost-found/${lost.id}`, finder).expect(200)).body as ReportBody;
    expect(detail).toMatchObject({ itemDateTo: day(-2), color: 'blue', brand: 'Milton' });

    const list = (await as('get', '/lost-found?limit=50', finder).expect(200)).body as { data: ReportBody[] };
    expect(list.data.find((r) => r.id === lost.id)).toMatchObject({ itemDateTo: day(-2), color: 'blue', brand: 'Milton' });

    const mine = (await as('get', '/lost-found/mine', owner).expect(200)).body as { filed: { items: ReportBody[] } };
    expect(JSON.stringify(mine)).toContain('"brand":"Milton"');

    const matches = (await as('get', `/lost-found/${lost.id}/matches`, owner).expect(200)).body as { report: ReportBody }[];
    expect(matches.find((m) => m.report.id === found.id)?.report).toMatchObject({ itemDateTo: null, color: 'blue', brand: null });
  });

  it('accepts a date one day past the UTC date, for users ahead of UTC', async () => {
    const res = await as('post', '/lost-found', owner).send(report('lost', { itemDate: day(-1), itemDateTo: day(1) })).expect(201);
    expect(res.body).toMatchObject({ itemDateTo: day(1) });
  });

  it('stores an end equal to the start as a single day', async () => {
    const res = await as('post', '/lost-found', owner).send(report('lost', { itemDate: day(-2), itemDateTo: day(-2) })).expect(201);
    expect(res.body).toMatchObject({ itemDate: day(-2), itemDateTo: null });
  });

  it.each([
    ['an unknown colour', { color: 'navy' }],
    ['a brand over 60 characters', { brand: 'x'.repeat(61) }],
    ['an end before the start', { itemDate: day(-3), itemDateTo: day(-4) }],
    ['a window over 30 days', { itemDate: day(-40), itemDateTo: day(-9) }],
    ['an end more than a day ahead', { itemDate: day(-1), itemDateTo: day(2) }],
    ['a start more than a day ahead', { itemDate: day(2) }],
    ['an end that is not a calendar date', { itemDateTo: '2026-02-30' }],
  ])('rejects %s with 400', async (_label, extra) => {
    await as('post', '/lost-found', owner).send(report('lost', extra)).expect(400);
  });

  it('requires authentication', async () => {
    await as('post', '/lost-found').send(report('lost', { color: 'blue' })).expect(401);
  });
});
