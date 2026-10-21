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
import { LoanEvent, LoanEventType } from '../src/borrow-requests/entities/loan-event.entity.js';
import { Review } from '../src/reviews/entities/review.entity.js';
import { REVIEW_WINDOW_DAYS } from '../src/reviews/reviews.service.js';

// Goal: prove reviews work on a loan produced by the REAL borrow + QR flow, not on hand-inserted rows.
// request -> approve -> pickup QR -> confirm pickup -> return QR -> confirm return -> reviews.

const PASSWORD = 'correct-horse-battery';
const EMAIL_LIKE = 'reviews-flow-%@example.com';
const IP = { owner: '203.0.113.51', borrower: '203.0.113.52' };

let app: INestApplication;
let ds: DataSource;

const rand = () => Math.random().toString(36).slice(2, 10);
const server = () => app.getHttpServer();
const call = (method: 'get' | 'post' | 'patch', path: string, who: 'owner' | 'borrower') => {
  const req = request(server())[method](path);
  return req.set('X-Forwarded-For', IP[who]).set('Authorization', `Bearer ${tokens[who]}`);
};

const tokens = { owner: '', borrower: '' };
const ids = { owner: '', borrower: '' };

async function makeUser(who: 'owner' | 'borrower') {
  const repo = ds.getRepository(User);
  const email = `reviews-flow-${who}-${rand()}@example.com`;
  const user = await repo.save(
    repo.create({
      name: `rf-${who}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: UserRole.STUDENT,
      campus: 'test',
      emailVerifiedAt: new Date(),
    }),
  );
  const res = await request(server())
    .post('/auth/login')
    .set('X-Forwarded-For', IP[who])
    .send({ email, password: PASSWORD })
    .expect(201);
  tokens[who] = res.body.accessToken as string;
  ids[who] = user.id;
}

let resourceId = '';
let loanId = '';

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

  await makeUser('owner');
  await makeUser('borrower');

  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const resource = await ds.getRepository(Resource).save(
    ds.getRepository(Resource).create({
      ownerId: ids.owner,
      categoryId: category.id,
      title: 'Flow-test calculator',
      description: null,
      isListed: true,
    }),
  );
  resourceId = resource.id;
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized) {
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
    await ds.query(`DELETE FROM users WHERE email LIKE ?`, [EMAIL_LIKE]);
  }
  await app?.close();
});

describe('review eligibility follows the real loan lifecycle', () => {
  it('request -> approve: not reviewable yet', async () => {
    const created = await call('post', '/borrow-requests', 'borrower')
      .send({ resourceId, dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString() })
      .expect(201);
    loanId = created.body.id as string;

    await call('patch', `/borrow-requests/${loanId}/approve`, 'owner').expect(200);

    const elig = await call('get', `/reviews/eligibility/${loanId}`, 'borrower').expect(200);
    expect(elig.body).toMatchObject({ eligible: false, reason: 'loan_not_returned' });
    await call('post', '/reviews', 'borrower').send({ borrowRequestId: loanId, rating: 5 }).expect(400);
  });

  it('pickup confirmed over QR: still not reviewable (loan is active)', async () => {
    const qr = await call('post', `/borrow-requests/${loanId}/pickup-qr`, 'owner').expect(201);
    await call('post', `/borrow-requests/${loanId}/confirm-pickup`, 'borrower')
      .send({ token: qr.body.token })
      .expect(201);

    const elig = await call('get', `/reviews/eligibility/${loanId}`, 'owner').expect(200);
    expect(elig.body).toMatchObject({ eligible: false, reason: 'loan_not_returned' });
    await call('post', '/reviews', 'owner').send({ borrowRequestId: loanId, rating: 5 }).expect(400);
  });

  it('return confirmed over QR: both sides become eligible and the events exist', async () => {
    const qr = await call('post', `/borrow-requests/${loanId}/return-qr`, 'borrower').expect(201);
    await call('patch', `/borrow-requests/${loanId}/return`, 'owner').send({ token: qr.body.token }).expect(200);

    // The review rules depend on exactly these two event types being written by the real flow.
    const events = await ds.query(
      'SELECT eventType FROM loan_events WHERE borrowRequestId = ? ORDER BY createdAt',
      [loanId],
    );
    const types = events.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain(LoanEventType.HANDED_OVER);
    expect(types).toContain(LoanEventType.RETURNED);

    // Time handling: createdAt is written by the database default (CURRENT_TIMESTAMP, DB clock) and read
    // by the driver. If the driver's timezone setting differs from the DB's, this is hours off, which
    // silently shortens or lengthens the 14-day review window.
    const returned = await ds
      .getRepository(LoanEvent)
      .findOneByOrFail({ borrowRequestId: loanId, eventType: LoanEventType.RETURNED });
    expect(Math.abs(returned.createdAt.getTime() - Date.now())).toBeLessThan(2 * 60_000);

    for (const who of ['borrower', 'owner'] as const) {
      const elig = await call('get', `/reviews/eligibility/${loanId}`, who).expect(200);
      expect(elig.body).toMatchObject({ eligible: true, reason: null, role: who });
    }
  });

  it('both sides review through HTTP; the second review reveals both; reputation follows', async () => {
    const first = await call('post', '/reviews', 'borrower')
      .send({ borrowRequestId: loanId, rating: 5, comment: 'Smooth handover' })
      .expect(201);
    expect(first.body.revealedAt).toBeNull();

    const hidden = await call('get', `/reviews/resource/${resourceId}`, 'owner').expect(200);
    expect(hidden.body.reviewCount).toBe(0); // blind until the owner also reviews

    const second = await call('post', '/reviews', 'owner').send({ borrowRequestId: loanId, rating: 4 }).expect(201);
    expect(second.body.revealedAt).not.toBeNull();

    const returned = await ds
      .getRepository(LoanEvent)
      .findOneByOrFail({ borrowRequestId: loanId, eventType: LoanEventType.RETURNED });
    const reviews = await ds.getRepository(Review).findBy({ borrowRequestId: loanId });
    expect(reviews).toHaveLength(2);
    for (const review of reviews) {
      const expected = returned.createdAt.getTime() + REVIEW_WINDOW_DAYS * 86_400_000;
      expect(Math.abs(review.windowClosesAt.getTime() - expected)).toBeLessThan(1000);
      expect(
        Math.abs(
          review.windowClosesAt.getTime() -
            (Date.now() + REVIEW_WINDOW_DAYS * 86_400_000),
        ),
      ).toBeLessThan(2 * 60_000);
    }

    const list = await call('get', `/reviews/resource/${resourceId}`, 'borrower').expect(200);
    expect(list.body).toMatchObject({ reviewCount: 1, averageRating: 5 });

    const ownerRep = await call('get', `/reviews/reputation/${ids.owner}`, 'borrower').expect(200);
    expect(ownerRep.body.reputationScore).toBe(3.75); // (5*3.5 + 5) / (5 + 1)
    const borrowerRep = await call('get', `/reviews/reputation/${ids.borrower}`, 'owner').expect(200);
    expect(borrowerRep.body.reputationScore).toBe(3.58); // (5*3.5 + 4) / (5 + 1) = 3.5833

    await call('post', '/reviews', 'borrower').send({ borrowRequestId: loanId, rating: 1 }).expect(409);
  });
});