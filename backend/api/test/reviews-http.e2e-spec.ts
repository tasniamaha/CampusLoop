
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

// Real HTTP stack: guards (JWT, verified-email, roles), ValidationPipe, ParseUUIDPipe,
// the real AuditService and the real audit_logs table. No service-level shortcuts.
// Test app has NO global "api" prefix (same as the other *-http specs): routes are /reviews/...

const PASSWORD = 'correct-horse-battery';
const EMAIL_LIKE = 'reviews-http-%@example.com';
// One distinct client IP per user so the per-IP login throttlers never interfere.
const IP = {
  owner: '203.0.113.41',
  borrower: '203.0.113.42',
  stranger: '203.0.113.43',
  unverified: '203.0.113.44',
  moderator: '203.0.113.45',
  admin: '203.0.113.46',
  demoted: '203.0.113.47',
  anon: '203.0.113.48',
  throttled: '203.0.113.49',
};
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

let app: INestApplication;
let ds: DataSource;

const rand = () => Math.random().toString(36).slice(2, 10);
const server = () => app.getHttpServer();
const api = (method: 'get' | 'post' | 'patch', path: string, token?: string, ip = IP.anon) => {
  const req = request(server())[method](path).set('X-Forwarded-For', ip);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

type Actor = { id: string; email: string; token: string };

async function makeUser(
  label: keyof typeof IP,
  opts: { role?: UserRole; verified?: boolean } = {},
): Promise<Actor> {
  const repo = ds.getRepository(User);
  const email = `reviews-http-${label}-${rand()}@example.com`;
  const user = await repo.save(
    repo.create({
      name: `rh-${label}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4), // cheap hash: only the code under test needs cost 12
      role: opts.role ?? UserRole.STUDENT,
      campus: 'test',
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    }),
  );
  const res = await request(server())
    .post('/auth/login')
    .set('X-Forwarded-For', IP[label])
    .send({ email, password: PASSWORD })
    .expect(201);
  return { id: user.id, email, token: res.body.accessToken as string };
}

/** A RETURNED loan with the QR-confirmed pickup and return events, as the real flow leaves it. */
async function seedReturnedLoan(ownerId: string, borrowerId: string, isListed = true) {
  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const resource = await ds.getRepository(Resource).save(
    ds.getRepository(Resource).create({
      ownerId,
      categoryId: category.id,
      title: 'Auth-test calculator',
      description: null,
      isListed,
    }),
  );
  const loan = await ds.getRepository(BorrowRequest).save(
    ds.getRepository(BorrowRequest).create({
      resourceId: resource.id,
      borrowerId,
      dueDate: new Date(Date.now() + 7 * 86_400_000),
      message: null,
      status: BorrowStatus.RETURNED,
    }),
  );
  const events = ds.getRepository(LoanEvent);
  await events.save(
    events.create({
      borrowRequestId: loan.id,
      resourceId: resource.id,
      actorId: ownerId,
      eventType: LoanEventType.HANDED_OVER,
      fromStatus: BorrowStatus.APPROVED,
      toStatus: BorrowStatus.ACTIVE,
      note: null,
    }),
  );
  await events.save(
    events.create({
      borrowRequestId: loan.id,
      resourceId: resource.id,
      actorId: ownerId,
      eventType: LoanEventType.RETURNED,
      fromStatus: BorrowStatus.ACTIVE,
      toStatus: BorrowStatus.RETURNED,
      note: null,
    }),
  );
  return { resource, loan };
}

const auditRows = (action: string, targetId: string) =>
  ds.query('SELECT actorId, metadata FROM audit_logs WHERE action = ? AND targetId = ?', [action, targetId]);

let owner: Actor;
let borrower: Actor;
let stranger: Actor;
let unverified: Actor;
let moderator: Actor;
let admin: Actor;
let demoted: Actor;
let throttled: Actor;
let resource: Resource;
let loan: BorrowRequest;
let unlistedResource: Resource;
let borrowerReviewId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({ send: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init(); // AppModule runs migrations itself (migrationsRun: true)
  ds = app.get(DataSource);

  owner = await makeUser('owner');
  borrower = await makeUser('borrower');
  stranger = await makeUser('stranger');
  unverified = await makeUser('unverified', { verified: false });
  moderator = await makeUser('moderator', { role: UserRole.MODERATOR });
  admin = await makeUser('admin', { role: UserRole.ADMIN });
  demoted = await makeUser('demoted', { role: UserRole.MODERATOR });
  throttled = await makeUser('throttled');

  ({ resource, loan } = await seedReturnedLoan(owner.id, borrower.id));
  ({ resource: unlistedResource } = await seedReturnedLoan(owner.id, borrower.id, false));
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    // reviews cascade from borrow_requests; loan_events are RESTRICT so go first.
    // audit_logs rows are append-only by design (triggers) and stay in the throwaway test DB.
    await ds.query(
      `DELETE le FROM loan_events le JOIN resources r ON r.id = le.resourceId
         JOIN users u ON u.id = r.ownerId WHERE u.email LIKE ?`,
      [EMAIL_LIKE],
    );
    await ds.query(
      `DELETE br FROM borrow_requests br JOIN resources r ON r.id = br.resourceId
         JOIN users u ON u.id = r.ownerId WHERE u.email LIKE ?`,
      [EMAIL_LIKE],
    );
    await ds.query(`DELETE FROM resources WHERE ownerId IN (SELECT id FROM users WHERE email LIKE ?)`, [EMAIL_LIKE]);
    await ds.query(`DELETE FROM reports WHERE reporterId IN (SELECT id FROM users WHERE email LIKE ?)`, [EMAIL_LIKE]);
    await ds.query(`DELETE FROM users WHERE email LIKE ?`, [EMAIL_LIKE]);
  }
  await app?.close();
});

describe('authentication: every reviews route rejects anonymous callers', () => {
  const routes: Array<['get' | 'post' | 'patch', string]> = [
    ['post', '/reviews'],
    ['get', `/reviews/eligibility/${MISSING_UUID}`],
    ['get', `/reviews/resource/${MISSING_UUID}`],
    ['get', `/reviews/reputation/${MISSING_UUID}`],
    ['post', `/reviews/${MISSING_UUID}/report`],
    ['patch', `/reviews/${MISSING_UUID}/hide`],
    ['patch', `/reviews/${MISSING_UUID}/unhide`],
  ];
  for (const [method, path] of routes) {
    it(`${method.toUpperCase()} ${path.replace(MISSING_UUID, ':id')} -> 401`, async () => {
      await api(method, path).send({}).expect(401);
    });
  }
});

describe('GET /reviews/eligibility/:borrowRequestId', () => {
  it('is 400 for a malformed id', async () => {
    await api('get', '/reviews/eligibility/not-a-uuid', borrower.token, IP.borrower).expect(400);
  });

  it('is 404 for an unknown loan', async () => {
    await api('get', `/reviews/eligibility/${MISSING_UUID}`, borrower.token, IP.borrower).expect(404);
  });

  it('is 403 for someone who is neither borrower nor owner', async () => {
    await api('get', `/reviews/eligibility/${loan.id}`, stranger.token, IP.stranger).expect(403);
  });

  it('tells the borrower and the owner they are eligible, with the right role', async () => {
    const b = await api('get', `/reviews/eligibility/${loan.id}`, borrower.token, IP.borrower).expect(200);
    expect(b.body).toMatchObject({ eligible: true, role: 'borrower', reason: null });
    const o = await api('get', `/reviews/eligibility/${loan.id}`, owner.token, IP.owner).expect(200);
    expect(o.body).toMatchObject({ eligible: true, role: 'owner', reason: null });
  });
});

describe('POST /reviews', () => {
  it('is 403 for an unverified email even with a valid bearer token', async () => {
    const res = await api('post', '/reviews', unverified.token, IP.unverified)
      .send({ borrowRequestId: loan.id, rating: 5 })
      .expect(403);
    expect(String(res.body.message)).toMatch(/verify your email/i);
  });

  it('rejects invalid bodies with 400 (rating range, bad uuid, unknown field)', async () => {
    const post = (body: object) => api('post', '/reviews', borrower.token, IP.borrower).send(body);
    await post({ borrowRequestId: loan.id, rating: 9 }).expect(400);
    await post({ borrowRequestId: loan.id, rating: 0 }).expect(400);
    await post({ borrowRequestId: 'nope', rating: 5 }).expect(400);
    await post({ borrowRequestId: loan.id, rating: 5, reviewerId: owner.id }).expect(400); // cannot forge the reviewer
    await post({ borrowRequestId: loan.id, rating: 5, comment: 'x'.repeat(1001) }).expect(400);
  });

  it('is 404 for an unknown loan', async () => {
    await api('post', '/reviews', borrower.token, IP.borrower)
      .send({ borrowRequestId: MISSING_UUID, rating: 5 })
      .expect(404);
  });

  it('is 403 for a verified user who is not part of the loan', async () => {
    await api('post', '/reviews', stranger.token, IP.stranger)
      .send({ borrowRequestId: loan.id, rating: 5 })
      .expect(403);
  });

  it('lets the borrower review once (201) and rejects the repeat (409)', async () => {
    const res = await api('post', '/reviews', borrower.token, IP.borrower)
      .send({ borrowRequestId: loan.id, rating: 4, comment: 'Worked fine' })
      .expect(201);
    expect(res.body).toMatchObject({
      reviewerId: borrower.id,
      revieweeId: owner.id,
      reviewerRole: 'borrower',
      rating: 4,
    });
    expect(res.body.revealedAt).toBeNull(); // blind until the owner also reviews
    borrowerReviewId = res.body.id as string;

    await api('post', '/reviews', borrower.token, IP.borrower)
      .send({ borrowRequestId: loan.id, rating: 1 })
      .expect(409);
  });
});

describe('POST /reviews/:id/report (blind reviews are not reportable until revealed)', () => {
  it('is 400 for a malformed id and for a too-short reason', async () => {
    await api('post', '/reviews/nope/report', stranger.token, IP.stranger).send({ reason: 'spam' }).expect(400);
    await api('post', `/reviews/${borrowerReviewId}/report`, stranger.token, IP.stranger)
      .send({ reason: 'ab' })
      .expect(400);
  });

  it('is 404 while the review is still blind', async () => {
    await api('post', `/reviews/${borrowerReviewId}/report`, stranger.token, IP.stranger)
      .send({ reason: 'looks fake' })
      .expect(404);
  });

  it('works once the owner has reviewed (both revealed); author cannot report own review', async () => {
    const ownerReview = await api('post', '/reviews', owner.token, IP.owner)
      .send({ borrowRequestId: loan.id, rating: 5 })
      .expect(201);
    expect(ownerReview.body.reviewerRole).toBe('owner');
    expect(ownerReview.body.revealedAt).not.toBeNull();

    await api('post', `/reviews/${borrowerReviewId}/report`, borrower.token, IP.borrower)
      .send({ reason: 'my own' })
      .expect(400);

    await api('post', `/reviews/${borrowerReviewId}/report`, stranger.token, IP.stranger)
      .send({ reason: 'looks fake' })
      .expect(201)
      .expect({ reported: true });

    // Real AuditService + real audit_logs table (not a stub).
    const rows = await auditRows('review.reported', borrowerReviewId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(stranger.id);
  });
});

describe('GET /reviews/resource/:resourceId', () => {
  it('shows a logged-in user only the revealed borrower review', async () => {
    const res = await api('get', `/reviews/resource/${resource.id}`, stranger.token, IP.stranger).expect(200);
    expect(res.body.reviewCount).toBe(1);
    expect(res.body.averageRating).toBe(4);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].reviewer.id).toBe(borrower.id);
    // No leakage of moderation / internal fields to ordinary readers.
    expect(JSON.stringify(res.body)).not.toMatch(/hiddenReason|hiddenById|windowClosesAt/);
  });

  it('is 400 for bad pagination values and a malformed id', async () => {
    const get = (qs: string) => api('get', `/reviews/resource/${resource.id}${qs}`, stranger.token, IP.stranger);
    await get('?page=0').expect(400);
    await get('?page=abc').expect(400);
    await get('?limit=0').expect(400);
    await api('get', '/reviews/resource/nope', stranger.token, IP.stranger).expect(400);
  });

  it('caps limit at 50 instead of failing', async () => {
    const res = await api('get', `/reviews/resource/${resource.id}?limit=9999`, stranger.token, IP.stranger).expect(200);
    expect(res.body.limit).toBe(50);
  });

  it('hides an unlisted resource from everyone but its owner', async () => {
    await api('get', `/reviews/resource/${unlistedResource.id}`, stranger.token, IP.stranger).expect(404);
    await api('get', `/reviews/resource/${unlistedResource.id}`, owner.token, IP.owner).expect(200);
  });
});

describe('GET /reviews/reputation/:userId', () => {
  it('returns the bounded score with its formula for a logged-in user', async () => {
    const res = await api('get', `/reviews/reputation/${owner.id}`, stranger.token, IP.stranger).expect(200);
    expect(res.body.userId).toBe(owner.id);
    expect(res.body.reviewCount).toBe(1);
    expect(res.body.reputationScore).toBe(3.58); // (5*3.5 + 4) / (5 + 1) = 3.5833
    expect(res.body.reputationScore).toBeGreaterThanOrEqual(1);
    expect(res.body.reputationScore).toBeLessThanOrEqual(5);
    expect(res.body.formula.priorWeight).toBe(5);
  });

  it('is 404 for an unknown user and 400 for a malformed id', async () => {
    await api('get', `/reviews/reputation/${MISSING_UUID}`, stranger.token, IP.stranger).expect(404);
    await api('get', '/reviews/reputation/nope', stranger.token, IP.stranger).expect(400);
  });
});

describe('moderation: PATCH /reviews/:id/hide and /unhide (roles guard)', () => {
  it('is 403 for students, including the review author and the reviewee', async () => {
    const students: Array<[Actor, string]> = [
      [stranger, IP.stranger],
      [borrower, IP.borrower],
      [owner, IP.owner],
    ];
    for (const [actor, ip] of students) {
      await api('patch', `/reviews/${borrowerReviewId}/hide`, actor.token, ip)
        .send({ reason: 'trying' })
        .expect(403);
    }
    // Still public: a refused request must not change anything.
    const res = await api('get', `/reviews/resource/${resource.id}`, stranger.token, IP.stranger).expect(200);
    expect(res.body.reviewCount).toBe(1);
  });

  it('is 400 for a moderator who gives no reason, 404 for an unknown review, 400 for a bad id', async () => {
    await api('patch', `/reviews/${borrowerReviewId}/hide`, moderator.token, IP.moderator).send({}).expect(400);
    await api('patch', `/reviews/${MISSING_UUID}/hide`, moderator.token, IP.moderator).send({ reason: 'x' }).expect(404);
    await api('patch', '/reviews/nope/hide', moderator.token, IP.moderator).send({ reason: 'x' }).expect(400);
  });

  it('lets a moderator hide: the review leaves the list and reputation, and the action is audited', async () => {
    const res = await api('patch', `/reviews/${borrowerReviewId}/hide`, moderator.token, IP.moderator)
      .send({ reason: 'abusive comment' })
      .expect(200);
    expect(res.body).toEqual({ id: borrowerReviewId, isHidden: true });

    const list = await api('get', `/reviews/resource/${resource.id}`, stranger.token, IP.stranger).expect(200);
    expect(list.body.reviewCount).toBe(0);
    const rep = await api('get', `/reviews/reputation/${owner.id}`, stranger.token, IP.stranger).expect(200);
    expect(rep.body.reviewCount).toBe(0);
    expect(rep.body.reputationScore).toBe(3.5); // back to the prior

    const rows = await auditRows('review.hidden', borrowerReviewId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(moderator.id);
  });

  it('a hidden review can no longer be reported (404)', async () => {
    await api('post', `/reviews/${borrowerReviewId}/report`, stranger.token, IP.stranger)
      .send({ reason: 'again' })
      .expect(404);
  });

  it('students cannot unhide; an admin can, and it is audited', async () => {
    await api('patch', `/reviews/${borrowerReviewId}/unhide`, stranger.token, IP.stranger).send({}).expect(403);
    await api('patch', `/reviews/${borrowerReviewId}/unhide`, admin.token, IP.admin)
      .send({ reason: 'appeal accepted' })
      .expect(200)
      .expect({ id: borrowerReviewId, isHidden: false });

    const list = await api('get', `/reviews/resource/${resource.id}`, stranger.token, IP.stranger).expect(200);
    expect(list.body.reviewCount).toBe(1);
    const rows = await auditRows('review.unhidden', borrowerReviewId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(admin.id);
  });

  it('uses the CURRENT role from the database, not the role baked into an old token', async () => {
    // `demoted` logged in as a moderator in beforeAll; strip the role afterwards.
    await ds.query(`UPDATE users SET role = 'student' WHERE id = ?`, [demoted.id]);
    await api('patch', `/reviews/${borrowerReviewId}/hide`, demoted.token, IP.demoted)
      .send({ reason: 'stale token' })
      .expect(403);
    const list = await api('get', `/reviews/resource/${resource.id}`, stranger.token, IP.stranger).expect(200);
    expect(list.body.reviewCount).toBe(1); // nothing was hidden
  });
});

describe('rate limiting', () => {
  it('POST /reviews allows 10 requests per minute per user, then 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // Invalid body on purpose: the throttler runs before validation, so these still count.
      statuses.push((await api('post', '/reviews', throttled.token, IP.throttled).send({})).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});