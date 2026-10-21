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
import { BorrowRequest, BorrowStatus } from '../src/borrow-requests/entities/borrow-request.entity.js';
import { LoanEvent, LoanEventType } from '../src/borrow-requests/entities/loan-event.entity.js';
import { Review } from '../src/reviews/entities/review.entity.js';
import { Report, ReportStatus, ReportTarget } from '../src/reports/entities/report.entity.js';

const PASSWORD = 'correct-horse-battery';
const EMAIL_LIKE = 'moderation-reports-%@example.com';
const IP = {
  owner: '203.0.113.71',
  borrower: '203.0.113.72',
  reporter: '203.0.113.73',
  reporter2: '203.0.113.74',
  unverified: '203.0.113.75',
  moderator: '203.0.113.76',
  admin: '203.0.113.77',
  student: '203.0.113.78',
  anon: '203.0.113.79',
  moderator2: '203.0.113.80',
};
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

let app: INestApplication;
let ds: DataSource;

type Actor = { id: string; token: string };
const actors = {} as Record<keyof typeof IP, Actor>;
const server = () => app.getHttpServer();

function api(
  method: 'get' | 'post' | 'patch',
  path: string,
  actor?: keyof typeof IP,
) {
  const req = request(server())[method](path).set('X-Forwarded-For', actor ? IP[actor] : IP.anon);
  return actor ? req.set('Authorization', `Bearer ${actors[actor].token}`) : req;
}

async function makeUser(
  label: keyof typeof IP,
  role = UserRole.STUDENT,
  verified = true,
  campus = 'test',
) {
  const email = `moderation-reports-${label}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
  const response = await request(server())
    .post('/auth/login')
    .set('X-Forwarded-For', IP[label])
    .send({ email, password: PASSWORD })
    .expect(201);
  actors[label] = { id: user.id, token: response.body.accessToken as string };
}

async function seedReview(campus = 'test') {
  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({
    slug: 'calculators',
  });
  const owner = await ds.getRepository(User).save(
    ds.getRepository(User).create({
      name: 'report-target-owner',
      email: `moderation-reports-owner-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: 'x',
      role: UserRole.STUDENT,
      campus,
      emailVerifiedAt: new Date(),
    }),
  );
  const borrower = await ds.getRepository(User).save(
    ds.getRepository(User).create({
      name: 'report-target-borrower',
      email: `moderation-reports-borrower-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: 'x',
      role: UserRole.STUDENT,
      campus,
      emailVerifiedAt: new Date(),
    }),
  );
  const resource = await ds.getRepository(Resource).save(
    ds.getRepository(Resource).create({
      ownerId: owner.id,
      categoryId: category.id,
      title: 'Moderation test resource',
      description: null,
      isListed: true,
    }),
  );
  const loan = await ds.getRepository(BorrowRequest).save(
    ds.getRepository(BorrowRequest).create({
      resourceId: resource.id,
      borrowerId: borrower.id,
      dueDate: new Date(Date.now() + 86_400_000),
      message: null,
      status: BorrowStatus.RETURNED,
    }),
  );
  const eventRepo = ds.getRepository(LoanEvent);
  await eventRepo.save(
    eventRepo.create({
      borrowRequestId: loan.id,
      resourceId: resource.id,
      actorId: owner.id,
      eventType: LoanEventType.HANDED_OVER,
      fromStatus: BorrowStatus.APPROVED,
      toStatus: BorrowStatus.ACTIVE,
      note: null,
    }),
  );
  await eventRepo.save(
    eventRepo.create({
      borrowRequestId: loan.id,
      resourceId: resource.id,
      actorId: owner.id,
      eventType: LoanEventType.RETURNED,
      fromStatus: BorrowStatus.ACTIVE,
      toStatus: BorrowStatus.RETURNED,
      note: null,
    }),
  );
  const review = await ds.getRepository(Review).save(
    ds.getRepository(Review).create({
      borrowRequestId: loan.id,
      resourceId: resource.id,
      reviewerId: borrower.id,
      reviewerRole: 'borrower',
      revieweeId: owner.id,
      rating: 4,
      comment: 'Test review',
      revealedAt: new Date(),
      windowClosesAt: new Date(Date.now() + 86_400_000),
      isHidden: false,
      hiddenAt: null,
      hiddenById: null,
      hiddenReason: null,
    }),
  );
  return { owner, borrower, resource, loan, review };
}

let mainReview: Review;
let secondReview: Review;
let remoteReview: Review;

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
  await makeUser('borrower');
  await makeUser('reporter');
  await makeUser('reporter2');
  await makeUser('unverified', UserRole.STUDENT, false);
  await makeUser('moderator', UserRole.MODERATOR);
  await makeUser('moderator2', UserRole.MODERATOR, true, 'other-campus');
  await makeUser('admin', UserRole.ADMIN);
  await makeUser('student');

  mainReview = (await seedReview()).review;
  secondReview = (await seedReview()).review;
  remoteReview = (await seedReview('other-campus')).review;
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
        `DELETE le FROM loan_events le JOIN resources r ON r.id = le.resourceId
         JOIN users owner ON owner.id = r.ownerId
         WHERE owner.email LIKE 'moderation-reports-%@example.com'`,
      );
      await ds.query(
        `DELETE br FROM borrow_requests br JOIN resources r ON r.id = br.resourceId
         JOIN users owner ON owner.id = r.ownerId
         WHERE owner.email LIKE 'moderation-reports-%@example.com'`,
      );
      await ds.query(
        `DELETE FROM resources WHERE ownerId IN
         (SELECT id FROM users WHERE email LIKE 'moderation-reports-%@example.com')`,
      );
      await ds.query(`DELETE FROM users WHERE email LIKE 'moderation-reports-%@example.com'`);
    } finally {
      await app?.close();
    }
  } else {
    await app?.close();
  }
});

describe('moderation report authorization', () => {
  it('rejects anonymous callers and students from the moderation queue', async () => {
    await api('get', '/moderation/reports').expect(401);
    await api('patch', `/moderation/reports/${MISSING_UUID}/resolve`)
      .send({ status: ReportStatus.RESOLVED })
      .expect(401);
    await api('get', '/moderation/reports', 'student').expect(403);
    await api('patch', `/moderation/reports/${MISSING_UUID}/resolve`, 'student')
      .send({ status: ReportStatus.RESOLVED })
      .expect(403);
  });

  it('rejects reports from unverified users', async () => {
    await api('post', `/reviews/${mainReview.id}/report`, 'unverified')
      .send({ reason: 'inappropriate' })
      .expect(403);
  });

  it('validates malformed and unknown report IDs', async () => {
    await api('patch', '/moderation/reports/not-a-uuid/resolve', 'moderator')
      .send({ status: ReportStatus.RESOLVED })
      .expect(400);
    await api('patch', `/moderation/reports/${MISSING_UUID}/resolve`, 'moderator')
      .send({ status: ReportStatus.RESOLVED })
      .expect(404);
  });
});

describe('review reports and moderator queue', () => {
  let mainReportId: string;
  let secondReportId: string;

  it('creates a report once and rejects duplicate reports by the same reporter', async () => {
    await api('post', `/reviews/${mainReview.id}/report`, 'reporter')
      .send({ reason: 'Looks suspicious' })
      .expect(201, { reported: true });
    await api('post', `/reviews/${mainReview.id}/report`, 'reporter')
      .send({ reason: 'Still suspicious' })
      .expect(409);

    const report = await ds.getRepository(Report).findOneByOrFail({
      reporterId: actors.reporter.id,
      targetType: ReportTarget.REVIEW,
      targetId: mainReview.id,
    });
    mainReportId = report.id;
    expect(
      await ds.getRepository(Report).count({
        where: {
          reporterId: actors.reporter.id,
          targetType: ReportTarget.REVIEW,
          targetId: mainReview.id,
        },
      }),
    ).toBe(1);
  });

  it('lists oldest open reports first, filters by status, and scopes moderators to campus', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await api('post', `/reviews/${secondReview.id}/report`, 'reporter2')
      .send({ reason: 'Potential abuse' })
      .expect(201);
    await api('post', `/reviews/${remoteReview.id}/report`, 'reporter')
      .send({ reason: 'Remote campus issue' })
      .expect(201);

    const second = await ds.getRepository(Report).findOneByOrFail({
      reporterId: actors.reporter2.id,
      targetId: secondReview.id,
    });
    secondReportId = second.id;

    const response = await api('get', '/moderation/reports?status=open', 'moderator').expect(200);
    expect(response.body.items.map((item: Report) => item.id)).toEqual([
      mainReportId,
      secondReportId,
    ]);
    expect(response.body.items.every((item: Report) => item.status === ReportStatus.OPEN)).toBe(true);

    const adminResponse = await api('get', '/moderation/reports?status=open', 'admin').expect(200);
    expect(adminResponse.body.total).toBe(3);
  });

  it('lets moderators resolve or dismiss reports and prevents closing twice', async () => {
    await api('patch', `/moderation/reports/${mainReportId}/resolve`, 'moderator')
      .send({ status: ReportStatus.RESOLVED, note: 'Reviewed and hidden' })
      .expect(200, { id: mainReportId, status: ReportStatus.RESOLVED });
    await api('patch', `/moderation/reports/${mainReportId}/resolve`, 'moderator')
      .send({ status: ReportStatus.DISMISSED })
      .expect(409);
    await api('patch', `/moderation/reports/${secondReportId}/resolve`, 'moderator')
      .send({ status: ReportStatus.DISMISSED })
      .expect(200, { id: secondReportId, status: ReportStatus.DISMISSED });
    const closed = await api(
      'get',
      `/moderation/reports?status=${ReportStatus.RESOLVED}`,
      'moderator',
    ).expect(200);
    expect(closed.body.items.map((item: Report) => item.id)).toContain(mainReportId);
  });

  it('prevents a moderator from resolving their own report', async () => {
    const report = await ds.getRepository(Report).save(
      ds.getRepository(Report).create({
        reporterId: actors.moderator.id,
        targetType: ReportTarget.REVIEW,
        targetId: secondReview.id,
        reason: 'Moderator report',
        status: ReportStatus.OPEN,
        resolvedById: null,
        resolvedAt: null,
        resolutionNote: null,
      }),
    );
    await api('patch', `/moderation/reports/${report.id}/resolve`, 'moderator')
      .send({ status: ReportStatus.RESOLVED })
      .expect(403);
  });

  it('hiding a review resolves its open reports and records audit events', async () => {
    const reviewToHide = (await seedReview()).review;
    await api('post', `/reviews/${reviewToHide.id}/report`, 'reporter')
      .send({ reason: 'Please review this' })
      .expect(201);
    const report = await ds.getRepository(Report).findOneByOrFail({
      reporterId: actors.reporter.id,
      targetId: reviewToHide.id,
    });
    await api('patch', `/reviews/${reviewToHide.id}/hide`, 'moderator')
      .send({ reason: 'Violates community rules' })
      .expect(200);

    const closed = await ds.getRepository(Report).findOneByOrFail({ id: report.id });
    expect(closed.status).toBe(ReportStatus.RESOLVED);
    const auditRows = await ds.query(
      `SELECT action FROM audit_logs
       WHERE targetId IN (?, ?) AND action IN ('review.hidden', 'report.resolved')`,
      [reviewToHide.id, report.id],
    );
    expect(auditRows.map((row: { action: string }) => row.action).sort()).toEqual([
      'report.resolved',
      'review.hidden',
    ]);
  });

  it('blocks moderators from other campuses from resolving or hiding reviews', async () => {
    const review = (await seedReview()).review;
    await api('post', `/reviews/${review.id}/report`, 'reporter')
      .send({ reason: 'Campus scope test' })
      .expect(201);
    const report = await ds.getRepository(Report).findOneByOrFail({
      reporterId: actors.reporter.id,
      targetId: review.id,
    });

    await api('patch', `/moderation/reports/${report.id}/resolve`, 'moderator2')
      .send({ status: ReportStatus.RESOLVED })
      .expect(404);
    await api('patch', `/reviews/${review.id}/hide`, 'moderator2')
      .send({ reason: 'Not in my campus' })
      .expect(404);
    expect((await ds.getRepository(Report).findOneByOrFail({ id: report.id })).status).toBe(
      ReportStatus.OPEN,
    );
  });

  it('blocks a moderator who is the reviewee from resolving or hiding', async () => {
    const review = (await seedReview()).review;
    await ds.query('UPDATE reviews SET revieweeId = ? WHERE id = ?', [
      actors.moderator.id,
      review.id,
    ]);
    await api('post', `/reviews/${review.id}/report`, 'reporter')
      .send({ reason: 'Conflict test' })
      .expect(201);
    const report = await ds.getRepository(Report).findOneByOrFail({
      reporterId: actors.reporter.id,
      targetId: review.id,
    });

    await api('patch', `/moderation/reports/${report.id}/resolve`, 'moderator')
      .send({ status: ReportStatus.RESOLVED })
      .expect(403);
    await api('patch', `/reviews/${review.id}/hide`, 'moderator')
      .send({ reason: 'Conflict of interest' })
      .expect(403);
  });

  it('does not let a moderator hide a review they reported', async () => {
    const review = (await seedReview()).review;
    await api('post', `/reviews/${review.id}/report`, 'moderator')
      .send({ reason: 'Moderator self-report' })
      .expect(201);
    await api('patch', `/reviews/${review.id}/hide`, 'moderator')
      .send({ reason: 'My report' })
      .expect(403);
    await api('patch', `/reviews/${review.id}/hide`, 'admin')
      .send({ reason: 'Admin review' })
      .expect(200);
  });

  it('validates queue filters and records resolution audit metadata', async () => {
    await api('get', '/moderation/reports?status=bogus', 'moderator').expect(400);
    await api('get', '/moderation/reports?page=0', 'moderator').expect(400);
    await api('get', '/moderation/reports?limit=999', 'moderator').expect(400);

    const review = (await seedReview()).review;
    await api('post', `/reviews/${review.id}/report`, 'reporter')
      .send({ reason: 'Audit test' })
      .expect(201);
    const report = await ds.getRepository(Report).findOneByOrFail({
      reporterId: actors.reporter.id,
      targetId: review.id,
    });
    await api('patch', `/moderation/reports/${report.id}/resolve`, 'moderator')
      .send({ status: ReportStatus.DISMISSED, note: 'Reviewed' })
      .expect(200);

    const closed = await ds.getRepository(Report).findOneByOrFail({ id: report.id });
    expect(closed.resolvedById).toBe(actors.moderator.id);
    expect(closed.resolvedAt).not.toBeNull();
    const rows = await ds.query(
      `SELECT actorId FROM audit_logs
       WHERE action = 'report.dismissed' AND targetId = ?`,
      [report.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(actors.moderator.id);
  });
});
