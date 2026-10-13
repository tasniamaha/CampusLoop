import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Resource } from '../resources/entities/resource.entity.js';
import { User } from '../users/entities/user.entity.js';
import {
  BorrowRequest,
  BorrowStatus,
  OCCUPYING_STATUSES,
} from './entities/borrow-request.entity.js';
import { CreateBorrowRequestDto } from './dto/create-borrow-request.dto.js';
import { ListBorrowRequestsQueryDto } from './dto/list-borrow-requests-query.dto.js';
import { isDuplicateEntry } from '../common/db-errors.js';

interface RawListRow {
  id: string;
  status: BorrowStatus;
  dueDate: Date;
  message: string | null;
  createdAt: Date;
  updatedAt: Date;
  resourceId: string;
  resourceTitle: string;
  borrowerId: string;
  borrowerName: string;
  ownerId: string;
  ownerName: string;
}

@Injectable()
export class BorrowRequestsService {
  constructor(private readonly dataSource: DataSource) {}

  // ---------------- create ----------------

  async create(borrowerId: string, dto: CreateBorrowRequestDto) {
    const resource = await this.dataSource
      .getRepository(Resource)
      .findOne({ where: { id: dto.resourceId } });

    if (!resource || !resource.isListed) {
      throw new NotFoundException('Resource not found');
    }
    if (resource.ownerId === borrowerId) {
      throw new BadRequestException('You cannot borrow your own resource');
    }

    const dueDate = new Date(dto.dueDate);
    const now = Date.now();
    if (
      Number.isNaN(dueDate.getTime()) ||
      dueDate.getTime() <= now ||
      dueDate.getTime() > now + resource.maxLoanDays * 24 * 3600 * 1000
    ) {
      throw new BadRequestException(
        `dueDate must be in the future and within ${resource.maxLoanDays} days`,
      );
    }

    const repo = this.dataSource.getRepository(BorrowRequest);
    const existing = await repo.count({
      where: {
        resourceId: dto.resourceId,
        borrowerId,
        status: BorrowStatus.PENDING,
      },
    });
    if (existing > 0) {
      throw new ConflictException('You already have a pending request for this resource');
    }

    return repo.save(
      repo.create({
        resourceId: dto.resourceId,
        borrowerId,
        dueDate,
        message: dto.message?.trim() ?? null,
        status: BorrowStatus.PENDING,
      }),
    );
  }

  // ---------------- list ----------------

  async list(userId: string, query: ListBorrowRequestsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const countRow = await this.listBase(userId, query)
      .select('COUNT(*)', 'total')
      .getRawOne<{ total: string }>();
    const total = Number(countRow?.total ?? 0);

    const rows = await this.listBase(userId, query)
      .select('br.id', 'id')
      .addSelect('br.status', 'status')
      .addSelect('br.dueDate', 'dueDate')
      .addSelect('br.message', 'message')
      .addSelect('br.createdAt', 'createdAt')
      .addSelect('br.updatedAt', 'updatedAt')
      .addSelect('r.id', 'resourceId')
      .addSelect('r.title', 'resourceTitle')
      .addSelect('bu.id', 'borrowerId')
      .addSelect('bu.name', 'borrowerName') // names only: no emails exposed
      .addSelect('ou.id', 'ownerId')
      .addSelect('ou.name', 'ownerName')
      .orderBy('br.createdAt', 'DESC')
      .addOrderBy('br.id', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<RawListRow>();

    const now = Date.now();
    const items = rows.map((r) => ({
      id: r.id,
      status: r.status,
      dueDate: r.dueDate,
      message: r.message,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isOverdue:
        OCCUPYING_STATUSES.includes(r.status) && new Date(r.dueDate).getTime() < now,
      resource: { id: r.resourceId, title: r.resourceTitle },
      borrower: { id: r.borrowerId, name: r.borrowerName },
      owner: { id: r.ownerId, name: r.ownerName },
    }));

    return { items, total, page, limit };
  }

  // ---------------- approve (owner) ----------------

  /** Serialised per resource via row lock; DB unique index is the backstop. */
  async approve(requestId: string, ownerId: string) {
    const resourceId = await this.peekResourceId(requestId);

    let outcome: { expired: true } | { approved: BorrowRequest };
    try {
      outcome = await this.dataSource.transaction(async (manager) => {
        const { request } = await this.lockAndLoad(manager, resourceId, requestId, ownerId);

        if (request.status !== BorrowStatus.PENDING) {
          throw new ConflictException(`Request is ${request.status}, not pending`);
        }

        // The due date may have passed while the request waited for approval.
        // Mark it expired and commit that change (do not throw inside the transaction).
        if (new Date(request.dueDate).getTime() <= Date.now()) {
          await manager.update(BorrowRequest, { id: requestId }, { status: BorrowStatus.EXPIRED });
          return { expired: true as const };
        }

        // Locking read: sees the latest committed state, not a stale snapshot.
        const occupying = await manager.find(BorrowRequest, {
          select: { id: true },
          where: { resourceId, status: In(OCCUPYING_STATUSES) },
          lock: { mode: 'pessimistic_write' },
        });
        if (occupying.length > 0) {
          throw new ConflictException('Resource is already on loan');
        }

        await manager.update(BorrowRequest, { id: requestId }, { status: BorrowStatus.APPROVED });
        request.status = BorrowStatus.APPROVED;
        return { approved: request };
      });
    } catch (err) {
      // Backstop: if the lock logic is ever bypassed or broken, the DB still refuses.
      if (isDuplicateEntry(err)) {
        throw new ConflictException('Resource is already on loan');
      }
      throw err;
    }

    if ('expired' in outcome) {
      throw new ConflictException(
        'This request expired because its due date has passed. Ask the borrower to submit a new one.',
      );
    }
    return outcome.approved;
  }

  // ---------------- reject / return (owner) ----------------

  reject(requestId: string, ownerId: string) {
    return this.ownerTransition(requestId, ownerId, [BorrowStatus.PENDING], BorrowStatus.REJECTED);
  }

  /** Owner confirms the item came back; releases the resource. */
  markReturned(requestId: string, ownerId: string) {
    return this.ownerTransition(
      requestId,
      ownerId,
      [BorrowStatus.APPROVED, BorrowStatus.ACTIVE],
      BorrowStatus.RETURNED,
    );
  }

  // ---------------- cancel (borrower) ----------------

  /**
   * Borrower withdraws a request. Allowed while pending or approved (before pickup).
   * Cancelling an approved request frees the resource immediately.
   */
  async cancel(requestId: string, borrowerId: string) {
    const resourceId = await this.peekResourceId(requestId);

    return this.dataSource.transaction(async (manager) => {
      // Same lock order as every other writer: resource first, then request.
      const resource = await manager.findOne(Resource, {
        where: { id: resourceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!resource) throw new NotFoundException('Resource not found');

      const request = await manager.findOne(BorrowRequest, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request) throw new NotFoundException('Borrow request not found');

      if (request.borrowerId !== borrowerId) {
        throw new ForbiddenException('Only the borrower can cancel this request');
      }
      if (![BorrowStatus.PENDING, BorrowStatus.APPROVED].includes(request.status)) {
        throw new ConflictException(`Cannot cancel a request that is ${request.status}`);
      }

      await manager.update(BorrowRequest, { id: requestId }, { status: BorrowStatus.CANCELLED });
      request.status = BorrowStatus.CANCELLED;
      return request;
    });
  }

  // ---------------- helpers ----------------

  private listBase(userId: string, q: ListBorrowRequestsQueryDto) {
    const qb = this.dataSource
      .createQueryBuilder()
      .from(BorrowRequest, 'br')
      .innerJoin(Resource, 'r', 'r.id = br.resourceId')
      .innerJoin(User, 'bu', 'bu.id = br.borrowerId')
      .innerJoin(User, 'ou', 'ou.id = r.ownerId')
      .withDeleted(); // keep history visible even if the resource was later soft-deleted

    if (q.role === 'incoming') qb.where('r.ownerId = :me', { me: userId });
    else qb.where('br.borrowerId = :me', { me: userId });

    if (q.status) qb.andWhere('br.status = :status', { status: q.status });
    return qb;
  }

  private async peekResourceId(requestId: string): Promise<string> {
    // Plain read OUTSIDE the transaction, only to learn which resource to lock.
    const row = await this.dataSource
      .getRepository(BorrowRequest)
      .findOne({ where: { id: requestId }, select: { id: true, resourceId: true } });
    if (!row) throw new NotFoundException('Borrow request not found');
    return row.resourceId;
  }

  private async lockAndLoad(
    manager: EntityManager,
    resourceId: string,
    requestId: string,
    ownerId: string,
  ) {
    // FIRST statement in the transaction: lock the resource row.
    const resource = await manager.findOne(Resource, {
      where: { id: resourceId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    if (resource.ownerId !== ownerId) {
      throw new ForbiddenException('Only the resource owner can do this');
    }

    // Re-read the request WITH a lock so we never act on stale status.
    const request = await manager.findOne(BorrowRequest, {
      where: { id: requestId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!request) throw new NotFoundException('Borrow request not found');

    return { resource, request };
  }

  private async ownerTransition(
    requestId: string,
    ownerId: string,
    allowedFrom: BorrowStatus[],
    to: BorrowStatus,
  ) {
    const resourceId = await this.peekResourceId(requestId);
    return this.dataSource.transaction(async (manager) => {
      const { request } = await this.lockAndLoad(manager, resourceId, requestId, ownerId);
      if (!allowedFrom.includes(request.status)) {
        throw new ConflictException(`Cannot move request from ${request.status} to ${to}`);
      }
      await manager.update(BorrowRequest, { id: requestId }, { status: to });
      request.status = to;
      return request;
    });
  }
}