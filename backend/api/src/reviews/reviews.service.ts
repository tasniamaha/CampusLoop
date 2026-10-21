import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import {
  BorrowRequest,
  BorrowStatus,
} from '../borrow-requests/entities/borrow-request.entity.js';
import {
  LoanEvent,
  LoanEventType,
} from '../borrow-requests/entities/loan-event.entity.js';
import { isDuplicateEntry } from '../common/db-errors.js';
import { Resource } from '../resources/entities/resource.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ReportTarget } from '../reports/entities/report.entity.js';
import { ReportsService } from '../reports/reports.service.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { Review } from './entities/review.entity.js';

export const REPUTATION_PRIOR_MEAN = 3.5;
export const REPUTATION_PRIOR_WEIGHT = 5;
export const REVIEW_WINDOW_DAYS = 14;

type Side = { role: 'borrower' | 'owner'; revieweeId: string };

const VISIBLE_SQL =
  '(review.isHidden = 0 AND (review.revealedAt IS NOT NULL OR review.windowClosesAt <= :now))';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  async create(reviewerId: string, dto: CreateReviewDto) {
    try {
      const resourceId = await this.peekResourceId(dto.borrowRequestId);

      return await this.dataSource.transaction(async (manager) => {
        const resource = await manager.findOne(Resource, {
          where: { id: resourceId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!resource) throw new NotFoundException('Resource not found');

        const loan = await manager.findOne(BorrowRequest, {
          where: { id: dto.borrowRequestId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!loan) throw new NotFoundException('Borrow request not found');
        if (loan.resourceId !== resourceId) {
          throw new ConflictException('The resource associated with this request has changed');
        }

        const side = this.resolveSide(resource, loan, reviewerId);
        if (loan.status !== BorrowStatus.RETURNED) {
          throw new BadRequestException('You can review only after the loan is returned');
        }

        const handover = await manager.findOne(LoanEvent, {
          where: { borrowRequestId: loan.id, eventType: LoanEventType.HANDED_OVER },
        });
        if (!handover) {
          throw new BadRequestException('A confirmed handover is required before reviewing');
        }

        const existing = await manager.findOne(Review, {
          where: { borrowRequestId: loan.id, reviewerId },
        });
        if (existing) throw new ConflictException('You have already reviewed this loan');

        const returned = await this.findReturnedEvent(manager, loan.id);
        if (!returned) {
          throw new BadRequestException('A confirmed return is required before reviewing');
        }
        const windowClosesAt = this.windowEnd(returned);
        if (new Date() > windowClosesAt) {
          throw new BadRequestException('The review window for this loan has closed');
        }

        const saved = await manager.save(
          Review,
          manager.create(Review, {
            borrowRequestId: loan.id,
            resourceId: loan.resourceId,
            reviewerId,
            reviewerRole: side.role,
            revieweeId: side.revieweeId,
            rating: dto.rating,
            comment: dto.comment?.trim() || null,
            revealedAt: null,
            windowClosesAt,
            isHidden: false,
            hiddenAt: null,
            hiddenById: null,
            hiddenReason: null,
          }),
        );

        const counterpart = await manager.findOne(Review, {
          where: { borrowRequestId: loan.id, reviewerId: side.revieweeId },
        });
        if (counterpart) {
          const revealedAt = new Date();
          await manager.update(
            Review,
            { borrowRequestId: loan.id },
            { revealedAt },
          );
          saved.revealedAt = revealedAt;
        }

        return saved;
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new ConflictException('You have already reviewed this loan');
      }
      throw error;
    }
  }

  private resolveSide(
    resource: Resource,
    loan: BorrowRequest,
    userId: string,
  ): Side {
    if (userId === loan.borrowerId) {
      return { role: 'borrower', revieweeId: resource.ownerId };
    }
    if (userId === resource.ownerId) {
      return { role: 'owner', revieweeId: loan.borrowerId };
    }
    throw new ForbiddenException(
      'Only the borrower or the resource owner can review this loan',
    );
  }

  private findReturnedEvent(manager: EntityManager, loanId: string) {
    return manager.findOne(LoanEvent, {
      where: { borrowRequestId: loanId, eventType: LoanEventType.RETURNED },
      order: { createdAt: 'DESC' },
    });
  }

  private windowEnd(returned: LoanEvent): Date {
    return new Date(
      returned.createdAt.getTime() + REVIEW_WINDOW_DAYS * 86_400_000,
    );
  }

  async getEligibility(borrowRequestId: string, userId: string) {
    const manager = this.dataSource.manager;
    const loan = await manager.findOne(BorrowRequest, {
      where: { id: borrowRequestId },
    });
    if (!loan) throw new NotFoundException('Borrow request not found');

    const resource = await manager.findOne(Resource, {
      where: { id: loan.resourceId },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    const side = this.resolveSide(resource, loan, userId);

    const existing = await manager.findOne(Review, {
      where: { borrowRequestId, reviewerId: userId },
    });
    if (existing) {
      return { eligible: false, reason: 'already_reviewed', role: side.role };
    }

    if (loan.status !== BorrowStatus.RETURNED) {
      return { eligible: false, reason: 'loan_not_returned', role: side.role };
    }

    const handover = await manager.findOne(LoanEvent, {
      where: { borrowRequestId: loan.id, eventType: LoanEventType.HANDED_OVER },
    });
    if (!handover) {
      return { eligible: false, reason: 'handover_not_confirmed', role: side.role };
    }

    const returned = await this.findReturnedEvent(manager, loan.id);
    if (!returned) {
      return { eligible: false, reason: 'return_not_confirmed', role: side.role };
    }

    const windowClosesAt = this.windowEnd(returned);
    if (new Date() > windowClosesAt) {
      return {
        eligible: false,
        reason: 'window_closed',
        role: side.role,
        windowClosesAt,
      };
    }

    return { eligible: true, reason: null, role: side.role, windowClosesAt };
  }

  async listForResource(
    resourceId: string,
    viewerId?: string,
    page = 1,
    limit = 10,
  ) {
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('Page must be a positive integer');
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException('Limit must be a positive integer');
    }
    limit = Math.min(limit, 50);

    const resource = await this.dataSource.getRepository(Resource).findOne({
      where: { id: resourceId },
    });
    if (!resource || (!resource.isListed && resource.ownerId !== viewerId)) {
      throw new NotFoundException('Resource not found');
    }

    const repo = this.dataSource.getRepository(Review);
    const now = new Date();
    const summary = await repo
      .createQueryBuilder('review')
      .select('COUNT(*)', 'reviewCount')
      .addSelect('AVG(review.rating)', 'averageRating')
      .where('review.resourceId = :resourceId', { resourceId })
      .andWhere("review.reviewerRole = 'borrower'")
      .andWhere(VISIBLE_SQL, { now })
      .getRawOne<{ reviewCount: string; averageRating: string | null }>();
    const reviewCount = Number(summary?.reviewCount ?? 0);

    const rows = await repo
      .createQueryBuilder('review')
      .innerJoin(User, 'reviewer', 'reviewer.id = review.reviewerId')
      .select('review.id', 'id')
      .addSelect('review.rating', 'rating')
      .addSelect('review.comment', 'comment')
      .addSelect('review.createdAt', 'createdAt')
      .addSelect('reviewer.id', 'reviewerId')
      .addSelect('reviewer.name', 'reviewerName')
      .where('review.resourceId = :resourceId', { resourceId })
      .andWhere("review.reviewerRole = 'borrower'")
      .andWhere(VISIBLE_SQL, { now })
      .orderBy('review.createdAt', 'DESC')
      .addOrderBy('review.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{
        id: string;
        rating: number | string;
        comment: string | null;
        createdAt: Date;
        reviewerId: string;
        reviewerName: string;
      }>();

    return {
      resourceId,
      reviewCount,
      averageRating:
        summary?.averageRating == null
          ? null
          : Math.round(Number(summary.averageRating) * 100) / 100,
      page,
      limit,
      totalPages: Math.ceil(reviewCount / limit),
      items: rows.map((row) => ({
        id: row.id,
        rating: Number(row.rating),
        comment: row.comment,
        createdAt: row.createdAt,
        reviewer: { id: row.reviewerId, name: row.reviewerName },
      })),
    };
  }

  async getReputation(userId: string) {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    const rows: Array<{ n: string | number; sum: string | number }> =
      await this.dataSource.query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(per.avgRating), 0) AS sum
           FROM (
             SELECT rv.reviewerId, AVG(rv.rating) AS avgRating
               FROM reviews rv
               JOIN borrow_requests br
                 ON br.id = rv.borrowRequestId AND br.status = ?
              WHERE rv.revieweeId = ?
                AND rv.isHidden = 0
                AND (rv.revealedAt IS NOT NULL OR rv.windowClosesAt <= ?)
                AND EXISTS (
                  SELECT 1 FROM loan_events le
                   WHERE le.borrowRequestId = rv.borrowRequestId
                     AND le.eventType = ?
                )
              GROUP BY rv.reviewerId
           ) per`,
        [BorrowStatus.RETURNED, userId, new Date(), LoanEventType.HANDED_OVER],
      );

    const reviewerCount = Number(rows[0]?.n ?? 0);
    const ratingSum = Number(rows[0]?.sum ?? 0);
    const reputationScore =
      (REPUTATION_PRIOR_WEIGHT * REPUTATION_PRIOR_MEAN + ratingSum) /
      (REPUTATION_PRIOR_WEIGHT + reviewerCount);

    return {
      userId,
      name: user.name,
      reviewCount: reviewerCount,
      rawAverage:
        reviewerCount === 0
          ? null
          : Math.round((ratingSum / reviewerCount) * 100) / 100,
      reputationScore: Math.round(reputationScore * 100) / 100,
      formula: {
        expression:
          '(priorWeight * priorMean + ratingSum) / (priorWeight + reviewerCount)',
        weighting:
          'one vote per distinct reviewer (that reviewer\'s ratings averaged)',
        priorMean: REPUTATION_PRIOR_MEAN,
        priorWeight: REPUTATION_PRIOR_WEIGHT,
        ratingSum,
      },
    };
  }

  async setHidden(
  actor: { id: string; role: string },
  reviewId: string,
  hidden: boolean,
  reason?: string,
) {
    const trimmed = reason?.trim() || null;
    if (hidden && !trimmed) {
        throw new BadRequestException('A reason is required to hide a review');
    }

    return this.dataSource.transaction(async (manager) => {
    const review = await manager.findOne(Review, {
      where: { id: reviewId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!review) throw new NotFoundException('Review not found');

    // campus first, so another campus gets a 404 and never learns the review exists
    await this.reports.assertInCampus(manager, actor.id, actor.role, ReportTarget.REVIEW, reviewId);

    if (review.reviewerId === actor.id || review.revieweeId === actor.id) {
      throw new ForbiddenException('You cannot moderate a review involving your account');
    }

      await manager.update(
        Review,
        { id: reviewId },
        {
          isHidden: hidden,
          hiddenAt: hidden ? new Date() : null,
          hiddenById: hidden ? actor.id : null,

          hiddenReason: hidden ? trimmed : null,
        },
      );

      if (hidden) {
        await this.reports.resolveForTarget(
          manager,
          ReportTarget.REVIEW,
          reviewId,
          actor.id,
          trimmed,
        );
      }

      await this.audit.record(manager, {
        actorId: actor.id,
        action: hidden ? 'review.hidden' : 'review.unhidden',
        targetType: 'review',
        targetId: reviewId,
        metadata: {
          reason: trimmed,
          reviewerId: review.reviewerId,
          revieweeId: review.revieweeId,
        },
      });

      return { id: reviewId, isHidden: hidden };
    });
  }

  async report(reporterId: string, reviewId: string, reason: string) {
    const review = await this.dataSource.getRepository(Review).findOne({
      where: { id: reviewId },
    });
    const visible =
      review &&
      !review.isHidden &&
      (review.revealedAt !== null || review.windowClosesAt <= new Date());
    if (!visible) throw new NotFoundException('Review not found');
    if (review.reviewerId === reporterId) {
      throw new BadRequestException('You cannot report your own review');
    }

    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException('Report reason must be at least 3 characters');
    }

    await this.dataSource.transaction((manager) =>
      this.reports.create(
        manager,
        reporterId,
        ReportTarget.REVIEW,
        reviewId,
        trimmed,
      ),
    );

    return { reported: true };
  }

  private async peekResourceId(requestId: string): Promise<string> {
    const row = await this.dataSource.getRepository(BorrowRequest).findOne({
      where: { id: requestId },
      select: { id: true, resourceId: true },
    });
    if (!row) throw new NotFoundException('Borrow request not found');
    return row.resourceId;
  }
}
