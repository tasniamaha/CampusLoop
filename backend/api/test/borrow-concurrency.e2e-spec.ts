import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { User, UserRole } from '../src/users/entities/user.entity.js';
import { Resource } from '../src/resources/entities/resource.entity.js';
import { BorrowRequest, BorrowStatus } from '../src/borrow-requests/entities/borrow-request.entity.js';
import { CreateUsers1791838335819 } from '../src/database/migrations/1791838335819-CreateUsers.js';
import { CreateResourcesAndBorrowRequests1791900000000 } from '../src/database/migrations/1791900000000-CreateResourcesAndBorrowRequests.js';
import { BorrowRequestsService } from '../src/borrow-requests/borrow-requests.service.js';
import { isDuplicateEntry } from '../src/common/db-errors.js';
import { ResourceCategory } from '../src/resources/entities/resource-category.entity.js';
import { ResourceImage } from '../src/resources/entities/resource-image.entity.js';
import { ResourceFavorite } from '../src/resources/entities/resource-favorite.entity.js';
import { ResourceMarketplace1792000000000 } from '../src/database/migrations/1792000000000-ResourceMarketplace.js';
let ds: DataSource;
let service: BorrowRequestsService;

const BORROWERS = 10;
const ROUNDS = 20;

async function seedUser(label: string) {
  return ds.getRepository(User).save(
    ds.getRepository(User).create({
      name: label,
      email: `${label}-${Math.random().toString(36).slice(2)}@test.local`,
      passwordHash: 'x',
      campus: 'test',
      role: UserRole.STUDENT,
      emailVerifiedAt: null,
    }),
  );
}

async function seedScenario(borrowerCount: number) {
  const owner = await seedUser('owner');
  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const resource = await ds.getRepository(Resource).save(
    ds.getRepository(Resource).create({
      ownerId: owner.id,
      categoryId: category.id,
      title: 'Scientific calculator',
      description: null,
      isListed: true,
    }),
  );
  const requests: BorrowRequest[] = [];
  for (let i = 0; i < borrowerCount; i++) {
    const borrower = await seedUser(`borrower${i}`);
    requests.push(
      await ds.getRepository(BorrowRequest).save(
        ds.getRepository(BorrowRequest).create({
          resourceId: resource.id,
          borrowerId: borrower.id,
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          message: null,
          status: BorrowStatus.PENDING,
        }),
      ),
    );
  }
  return { owner, resource, requests };
}

beforeAll(async () => {
  ds = new DataSource({
    type: 'mysql',
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT ?? 3307),
    username: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? 'root',
    database: process.env.TEST_DB_NAME ?? 'campusloop_test',
        entities: [User, Resource, BorrowRequest, ResourceCategory, ResourceImage, ResourceFavorite],
    migrations: [
      CreateUsers1791838335819,
      CreateResourcesAndBorrowRequests1791900000000,
      ResourceMarketplace1792000000000,
    ],
    dropSchema: true,
    synchronize: false,
    extra: { connectionLimit: 30 },
  });
  await ds.initialize();
  await ds.runMigrations(); // runs the REAL migrations, including the generated column
  service = new BorrowRequestsService(ds);
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

describe('double-booking protection', () => {
  it(`exactly one of ${BORROWERS} simultaneous approvals succeeds (x${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { owner, resource, requests } = await seedScenario(BORROWERS);

      const results = await Promise.allSettled(
        requests.map((r) => service.approve(r.id, owner.id)),
      );

      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(BORROWERS - 1);
      for (const f of failed) {
        expect(f.reason).toBeInstanceOf(ConflictException);
      }

      const approved = await ds.getRepository(BorrowRequest).count({
        where: { resourceId: resource.id, status: BorrowStatus.APPROVED },
      });
      expect(approved).toBe(1);
    }
  }, 120_000);

  it('database itself rejects a second active loan even if app code is bypassed', async () => {
    const { requests } = await seedScenario(2);
    await ds.query(`UPDATE borrow_requests SET status='approved' WHERE id=?`, [requests[0].id]);

    let error: unknown;
    try {
      await ds.query(`UPDATE borrow_requests SET status='approved' WHERE id=?`, [requests[1].id]);
    } catch (e) {
      error = e;
    }
    expect(isDuplicateEntry(error)).toBe(true);
  });

  it('resource is released after return and can then be approved for another borrower', async () => {
    const { owner, requests } = await seedScenario(2);

    await service.approve(requests[0].id, owner.id);
    await expect(service.approve(requests[1].id, owner.id)).rejects.toBeInstanceOf(ConflictException);

    await service.markReturned(requests[0].id, owner.id);
    await expect(service.approve(requests[1].id, owner.id)).resolves.toMatchObject({
      status: BorrowStatus.APPROVED,
    });
  });

  it('non-owner cannot approve', async () => {
    const { requests } = await seedScenario(1);
    const stranger = await seedUser('stranger');
    await expect(service.approve(requests[0].id, stranger.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('borrower can cancel an approved request, which frees the resource', async () => {
    const { owner, requests } = await seedScenario(2);

    await service.approve(requests[0].id, owner.id);
    await expect(service.approve(requests[1].id, owner.id)).rejects.toBeInstanceOf(ConflictException);

    await service.cancel(requests[0].id, requests[0].borrowerId);
    await expect(service.approve(requests[1].id, owner.id)).resolves.toMatchObject({
      status: BorrowStatus.APPROVED,
    });
  });

  it('only the borrower can cancel', async () => {
    const { owner, requests } = await seedScenario(1);
    await expect(service.cancel(requests[0].id, owner.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approving a request whose due date has passed marks it expired and does not occupy the resource', async () => {
    const { owner, requests } = await seedScenario(2);
    await ds.query(`UPDATE borrow_requests SET dueDate = ? WHERE id = ?`, [
      new Date(Date.now() - 60_000),
      requests[0].id,
    ]);

    await expect(service.approve(requests[0].id, owner.id)).rejects.toBeInstanceOf(ConflictException);

    const stored = await ds.getRepository(BorrowRequest).findOneByOrFail({ id: requests[0].id });
    expect(stored.status).toBe(BorrowStatus.EXPIRED);

    // The resource is still free for the next borrower.
    await expect(service.approve(requests[1].id, owner.id)).resolves.toMatchObject({
      status: BorrowStatus.APPROVED,
    });
  });
});