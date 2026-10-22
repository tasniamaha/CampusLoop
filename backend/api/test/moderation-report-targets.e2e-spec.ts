import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { Resource } from '../src/resources/entities/resource.entity.js';
import { ResourceCategory } from '../src/resources/entities/resource-category.entity.js';
import {
  LostFoundReport,
  LostFoundStatus,
  LostFoundType,
} from '../src/lost-found/entities/lost-found-report.entity.js';
import { Report, ReportStatus, ReportTarget } from '../src/reports/entities/report.entity.js';

const PASSWORD = 'correct-horse-battery';
const EMAIL_LIKE = 'mrt-%@example.com';
const RUN = Math.random().toString(36).slice(2, 8);
const IP = {
  owner: '203.0.113.81',
  reporter: '203.0.113.82',
  reporter2: '203.0.113.83',
  otherCampus: '203.0.113.84',
  unverified: '203.0.113.85',
  moderator: '203.0.113.86',
  moderator2: '203.0.113.87',
  admin: '203.0.113.88',
  anon: '203.0.113.89',
};
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

let app: INestApplication;
let ds: DataSource;
type Actor = { id: string; token: string };
const actors = {} as Record<keyof typeof IP, Actor>;
const server = () => app.getHttpServer();

function api(method: 'get' | 'post' | 'patch', path: string, who?: keyof typeof IP) {
  const req = request(server())[method](path).set('X-Forwarded-For', who ? IP[who] : IP.anon);
  return who ? req.set('Authorization', `Bearer ${actors[who].token}`) : req;
}

async function makeUser(
  label: keyof typeof IP,
  role = UserRole.STUDENT,
  verified = true,
  campus = 'test',
) {
  const email = `mrt-${label}-${RUN}@example.com`;
  const user = await ds.getRepository(User).save(
    ds.getRepository(User).create({
      name: label,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
      campus,
      emailVerifiedAt: verified ? new Date() : null,
    }),
  );
  const res = await request(server())
    .post('/auth/login')
    .set('X-Forwarded-For', IP[label])
    .send({ email, password: PASSWORD })
    .expect(201);
  actors[label] = { id: user.id, token: res.body.accessToken as string };
}

async function seedResource(ownerId: string, isListed = true) {
  const category = await ds
    .getRepository(ResourceCategory)
    .findOneByOrFail({ slug: 'calculators' });
  return ds.getRepository(Resource).save(
    ds.getRepository(Resource).create({
      ownerId,
      categoryId: category.id,
      title: 'Report-target resource',
      description: null,
      isListed,
    }),
  );
}

async function seedNotice(
  reporterId: string,
  campus = 'test',
  status = LostFoundStatus.OPEN,
) {
  return ds.getRepository(LostFoundReport).save(
    ds.getRepository(LostFoundReport).create({
      reporterId,
      campus,
      type: LostFoundType.LOST,
      title: 'Blue calculator',
      description: 'Left in lab',
      category: 'electronics',
      location: 'Lab 2',
      itemDate: '2026-10-01',
      imageUrl: null,
      status,
      resolvedAt: null,
    }),
  );
}

const reportRow = (
  reporter: keyof typeof IP,
  targetType: ReportTarget,
  targetId: string,
) =>
  ds.getRepository(Report).findOneBy({
    reporterId: actors[reporter].id,
    targetType,
    targetId,
  });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({ send: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  ds = app.get(DataSource);

  await makeUser('owner');
  await makeUser('reporter');
  await makeUser('reporter2');
  await makeUser('otherCampus', UserRole.STUDENT, true, 'other-campus');
  await makeUser('unverified', UserRole.STUDENT, false);
  await makeUser('moderator', UserRole.MODERATOR);
  await makeUser('moderator2', UserRole.MODERATOR, true, 'other-campus');
  await makeUser('admin', UserRole.ADMIN);
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    try {
      await ds.query(
        `DELETE FROM reports WHERE reporterId IN
         (SELECT id FROM users WHERE email LIKE ?)`,
        [EMAIL_LIKE],
      );
      await ds.query(
        `DELETE FROM lost_found_reports WHERE reporterId IN
         (SELECT id FROM users WHERE email LIKE ?)`,
        [EMAIL_LIKE],
      );
      await ds.query(
        `DELETE FROM resources WHERE ownerId IN
         (SELECT id FROM users WHERE email LIKE ?)`,
        [EMAIL_LIKE],
      );
      await ds.query('DELETE FROM users WHERE email LIKE ?', [EMAIL_LIKE]);
    } finally {
      await app?.close();
    }
  } else {
    await app?.close();
  }
});

describe('POST /resources/:id/report', () => {
  it('rejects anonymous and unverified callers, and malformed or missing IDs', async () => {
    const resource = await seedResource(actors.owner.id);
    await api('post', `/resources/${resource.id}/report`)
      .send({ reason: 'spam listing' })
      .expect(401);
    await api('post', `/resources/${resource.id}/report`, 'unverified')
      .send({ reason: 'spam listing' })
      .expect(403);
    await api('post', '/resources/nope/report', 'reporter')
      .send({ reason: 'spam listing' })
      .expect(400);
    await api('post', `/resources/${MISSING_UUID}/report`, 'reporter')
      .send({ reason: 'spam listing' })
      .expect(404);
  });

  it('validates short, whitespace-only, and unexpected body fields', async () => {
    const resource = await seedResource(actors.owner.id);
    await api('post', `/resources/${resource.id}/report`, 'reporter2')
      .send({ reason: 'ab' })
      .expect(400);
    await api('post', `/resources/${resource.id}/report`, 'reporter2')
      .send({ reason: '     ' })
      .expect(400);
    await api('post', `/resources/${resource.id}/report`, 'reporter2')
      .send({ reason: 'fine reason', reporterId: actors.owner.id })
      .expect(400);
    expect(await reportRow('reporter2', ReportTarget.RESOURCE, resource.id)).toBeNull();
  });

  it('creates one report, rejects duplicates, and blocks reporting your own listing', async () => {
    const resource = await seedResource(actors.owner.id);
    await api('post', `/resources/${resource.id}/report`, 'reporter')
      .send({ reason: 'misleading listing' })
      .expect(201, { reported: true });
    await api('post', `/resources/${resource.id}/report`, 'reporter')
      .send({ reason: 'again' })
      .expect(409);
    await api('post', `/resources/${resource.id}/report`, 'owner')
      .send({ reason: 'my own' })
      .expect(400);
    expect(
      await ds
        .getRepository(Report)
        .countBy({ targetType: ReportTarget.RESOURCE, targetId: resource.id }),
    ).toBe(1);
    const audit = await ds.query(
      `SELECT actorId FROM audit_logs
       WHERE action = 'resource.reported' AND targetId = ?`,
      [resource.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(actors.reporter.id);
  });

  it('hides unlisted and soft-deleted resources from other users', async () => {
    const unlisted = await seedResource(actors.owner.id, false);
    await api('post', `/resources/${unlisted.id}/report`, 'reporter')
      .send({ reason: 'not visible' })
      .expect(404);
    const deleted = await seedResource(actors.owner.id);
    await ds.query('UPDATE resources SET deletedAt = UTC_TIMESTAMP(6) WHERE id = ?', [
      deleted.id,
    ]);
    await api('post', `/resources/${deleted.id}/report`, 'reporter')
      .send({ reason: 'gone already' })
      .expect(404);
  });

  it('scopes moderator visibility and resolution to the resource campus', async () => {
    const resource = await seedResource(actors.owner.id);
    await api('post', `/resources/${resource.id}/report`, 'reporter')
      .send({ reason: 'campus scope' })
      .expect(201);
    const report = await reportRow('reporter', ReportTarget.RESOURCE, resource.id);
    const sameCampus = await api(
      'get',
      '/moderation/reports?status=open&limit=50',
      'moderator',
    ).expect(200);
    expect(sameCampus.body.items.map((item: Report) => item.id)).toContain(report!.id);
    const otherCampus = await api(
      'get',
      '/moderation/reports?status=open&limit=50',
      'moderator2',
    ).expect(200);
    expect(otherCampus.body.items.map((item: Report) => item.id)).not.toContain(report!.id);
    await api('patch', `/moderation/reports/${report!.id}/resolve`, 'moderator2')
      .send({ status: ReportStatus.RESOLVED })
      .expect(404);

    const moderatorOwned = await seedResource(actors.moderator.id);
    await api('post', `/resources/${moderatorOwned.id}/report`, 'reporter2')
      .send({ reason: 'owned by a moderator' })
      .expect(201);
    const conflict = await reportRow(
      'reporter2',
      ReportTarget.RESOURCE,
      moderatorOwned.id,
    );
    await api('patch', `/moderation/reports/${conflict!.id}/resolve`, 'moderator')
      .send({ status: ReportStatus.RESOLVED })
      .expect(403);
    await api('patch', `/moderation/reports/${conflict!.id}/resolve`, 'admin')
      .send({ status: ReportStatus.DISMISSED })
      .expect(200);
  });
});

describe('POST /lost-found/:id/report', () => {
  it('rejects anonymous and unverified callers, and malformed or missing IDs', async () => {
    const notice = await seedNotice(actors.owner.id);
    await api('post', `/lost-found/${notice.id}/report`)
      .send({ reason: 'not real' })
      .expect(401);
    await api('post', `/lost-found/${notice.id}/report`, 'unverified')
      .send({ reason: 'not real' })
      .expect(403);
    await api('post', '/lost-found/nope/report', 'reporter')
      .send({ reason: 'not real' })
      .expect(400);
    await api('post', `/lost-found/${MISSING_UUID}/report`, 'reporter')
      .send({ reason: 'not real' })
      .expect(404);
  });

  it('creates one report, rejects duplicates, and blocks reporting your own notice', async () => {
    const notice = await seedNotice(actors.owner.id);
    await api('post', `/lost-found/${notice.id}/report`, 'reporter2')
      .send({ reason: 'fake notice' })
      .expect(201, { reported: true });
    await api('post', `/lost-found/${notice.id}/report`, 'reporter2')
      .send({ reason: 'again' })
      .expect(409);
    await api('post', `/lost-found/${notice.id}/report`, 'owner')
      .send({ reason: 'my own' })
      .expect(400);
    expect(
      await ds
        .getRepository(Report)
        .countBy({ targetType: ReportTarget.LOST_FOUND, targetId: notice.id }),
    ).toBe(1);
  });

  it('rejects notices outside the reporter campus or no longer open', async () => {
    const notice = await seedNotice(actors.owner.id);
    await api('post', `/lost-found/${notice.id}/report`, 'otherCampus')
      .send({ reason: 'wrong campus' })
      .expect(404);
    const resolved = await seedNotice(
      actors.owner.id,
      'test',
      LostFoundStatus.RESOLVED,
    );
    await api('post', `/lost-found/${resolved.id}/report`, 'reporter2')
      .send({ reason: 'already resolved' })
      .expect(404);
  });

  it('scopes moderator visibility and resolution to the notice campus', async () => {
    const notice = await seedNotice(actors.owner.id);
    await api('post', `/lost-found/${notice.id}/report`, 'reporter2')
      .send({ reason: 'moderation scope' })
      .expect(201);
    const report = await reportRow('reporter2', ReportTarget.LOST_FOUND, notice.id);
    const otherCampus = await api(
      'get',
      '/moderation/reports?status=open&limit=50',
      'moderator2',
    ).expect(200);
    expect(otherCampus.body.items.map((item: Report) => item.id)).not.toContain(report!.id);
    await api('patch', `/moderation/reports/${report!.id}/resolve`, 'moderator2')
      .send({ status: ReportStatus.RESOLVED })
      .expect(404);
    await api('patch', `/moderation/reports/${report!.id}/resolve`, 'moderator')
      .send({ status: ReportStatus.RESOLVED, note: 'checked' })
      .expect(200);
    expect(
      (await ds.getRepository(Report).findOneByOrFail({ id: report!.id })).resolvedById,
    ).toBe(actors.moderator.id);
  });

  it('prevents a moderator who filed the notice from resolving a report about it', async () => {
    const notice = await seedNotice(actors.moderator.id);
    await api('post', `/lost-found/${notice.id}/report`, 'reporter2')
      .send({ reason: 'moderator-owned notice' })
      .expect(201);
    const report = await reportRow('reporter2', ReportTarget.LOST_FOUND, notice.id);
    await api('patch', `/moderation/reports/${report!.id}/resolve`, 'moderator')
      .send({ status: ReportStatus.RESOLVED })
      .expect(403);
  });
});
