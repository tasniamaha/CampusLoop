import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Resource } from '../resources/entities/resource.entity.js';
import {
  BorrowRequest,
  BorrowStatus,
  OCCUPYING_STATUSES,
} from './entities/borrow-request.entity.js';
import { CreateBorrowRequestDto } from './dto/create-borrow-request.dto.js';
import { isDuplicateEntry } from '../common/db-errors.js';

const MAX_LOAN_DAYS = 30;

@Injectable()
export class BorrowRequestsService {
  constructor(private readonly dataSource: DataSource) {}

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

  /** Owner approves. Serialised per resource via row lock; DB unique index is the backstop. */
  async approve(requestId: string, ownerId: string) {
    const peek = await this.peekResourceId(requestId);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const { request } = await this.lockAndLoad(manager, peek, requestId, ownerId);

        if (request.status !== BorrowStatus.PENDING) {
          throw new ConflictException(`Request is ${request.status}, not pending`);
        }

        // Locking read: sees the latest committed state, not a stale snapshot.
        const occupying = await manager.find(BorrowRequest, {
          where: { resourceId: peek, status: In(OCCUPYING_STATUSES) },
          lock: { mode: 'pessimistic_write' },
        });
        if (occupying.length > 0) {
          throw new ConflictException('Resource is already on loan');
        }

        await manager.update(BorrowRequest, { id: requestId }, { status: BorrowStatus.APPROVED });
        return { ...request, status: BorrowStatus.APPROVED };
      });
    } catch (err) {
      // Backstop: if the lock logic is ever bypassed or broken, the DB still refuses.
      if (isDuplicateEntry(err)) {
        throw new ConflictException('Resource is already on loan');
      }
      throw err;
    }
  }

  async reject(requestId: string, ownerId: string) {
    return this.ownerTransition(requestId, ownerId, [BorrowStatus.PENDING], BorrowStatus.REJECTED);
  }

  /** Owner confirms the item came back; releases the resource. */
  async markReturned(requestId: string, ownerId: string) {
    return this.ownerTransition(
      requestId,
      ownerId,
      [BorrowStatus.APPROVED, BorrowStatus.ACTIVE],
      BorrowStatus.RETURNED,
    );
  }

  // ---------- helpers ----------

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
      return { ...request, status: to };
    });
  }
}