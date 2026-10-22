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
import { isDuplicateEntry } from '../common/db-errors.js';
import { User, UserRole } from '../users/entities/user.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { Resource } from '../resources/entities/resource.entity.js';
import { LostFoundReport } from '../lost-found/entities/lost-found-report.entity.js';
import { Report, ReportStatus, ReportTarget } from './entities/report.entity.js';

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(
    manager: EntityManager,
    reporterId: string,
    targetType: ReportTarget,
    targetId: string,
    reason: string,
  ) {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException('Report reason must be at least 3 characters');
    }

    try {
      if (!(await this.targetExists(manager, targetType, targetId))) {
        throw new NotFoundException('Report target not found');
      }

      const saved = await manager.save(
        Report,
        manager.create(Report, {
          reporterId,
          targetType,
          targetId,
          reason: trimmed,
          status: ReportStatus.OPEN,
          resolvedById: null,
          resolvedAt: null,
          resolutionNote: null,
        }),
      );
      await this.audit.record(manager, {
        actorId: reporterId,
        action: `${targetType}.reported`,
        targetType,
        targetId,
        metadata: { reportId: saved.id, reason: trimmed },
      });
      return saved;
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new ConflictException('You have already reported this');
      }
      throw error;
    }
  }

  private async targetExists(
    manager: EntityManager,
    targetType: ReportTarget,
    targetId: string,
  ): Promise<boolean> {
    switch (targetType) {
      case ReportTarget.REVIEW:
        return !!(await manager.findOne(Review, { where: { id: targetId } }));
      case ReportTarget.RESOURCE:
        return !!(await manager.findOne(Resource, { where: { id: targetId } }));
      case ReportTarget.LOST_FOUND:
        return !!(await manager.findOne(LostFoundReport, { where: { id: targetId } }));
    }
  }

  async list(
    viewerId: string,
    viewerRole: string,
    status?: ReportStatus,
    page = 1,
    limit = 20,
  ) {
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('Page must be a positive integer');
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException('Limit must be a positive integer');
    }
    limit = Math.min(limit, 50);

    const query = this.dataSource.getRepository(Report).createQueryBuilder('report');
    if (status) query.where('report.status = :status', { status });

    if (viewerRole === UserRole.MODERATOR) {
      const moderator = await this.dataSource.getRepository(User).findOne({
        where: { id: viewerId },
        select: { id: true, campus: true },
      });
      if (!moderator) throw new NotFoundException('Moderator not found');
      query.andWhere(
        `(
          (report.targetType = :lostFoundType AND EXISTS (
            SELECT 1 FROM lost_found_reports lf
             WHERE lf.id = report.targetId AND lf.campus = :campus
          ))
          OR (report.targetType = :reviewType AND EXISTS (
            SELECT 1 FROM reviews rv
            JOIN resources r ON r.id = rv.resourceId
            JOIN users owner ON owner.id = r.ownerId
             WHERE rv.id = report.targetId AND owner.campus = :campus
          ))
          OR (report.targetType = :resourceType AND EXISTS (
            SELECT 1 FROM resources r
            JOIN users owner ON owner.id = r.ownerId
             WHERE r.id = report.targetId AND owner.campus = :campus
          ))
        )`,
        {
          lostFoundType: ReportTarget.LOST_FOUND,
          reviewType: ReportTarget.REVIEW,
          resourceType: ReportTarget.RESOURCE,
          campus: moderator.campus,
        },
      );
    }

    const [items, total] = await query
      .orderBy('report.createdAt', 'ASC')
      .addOrderBy('report.id', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    return { page, limit, total, totalPages: Math.ceil(total / limit), items };
  }

  async resolve(
    moderatorId: string,
    role: string,
    id: string,
    status: ReportStatus.RESOLVED | ReportStatus.DISMISSED,
    note?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const report = await manager.findOne(Report, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!report) throw new NotFoundException('Report not found');
      await this.assertInCampus(
        manager,
        moderatorId,
        role,
        report.targetType,
        report.targetId,
      );
      if (report.status !== ReportStatus.OPEN) {
        throw new ConflictException('Report is already closed');
      }
      if (report.reporterId === moderatorId) {
        throw new ForbiddenException('You cannot resolve your own report');
      }
      await this.assertNoConflict(manager, report, moderatorId);

      const trimmed = note?.trim() || null;
      await manager.update(
        Report,
        { id },
        {
          status,
          resolvedById: moderatorId,
          resolvedAt: new Date(),
          resolutionNote: trimmed,
        },
      );
      await this.audit.record(manager, {
        actorId: moderatorId,
        action: `report.${status}`,
        targetType: 'report',
        targetId: id,
        metadata: { target: report.targetType, targetRef: report.targetId, note: trimmed },
      });
      return { id, status };
    });
  }

  private async assertNoConflict(
    manager: EntityManager,
    report: Report,
    moderatorId: string,
  ) {
    let involved = false;
    switch (report.targetType) {
      case ReportTarget.REVIEW: {
        const review = await manager.findOne(Review, {
          where: { id: report.targetId },
        });
        involved =
          !!review &&
          (review.reviewerId === moderatorId || review.revieweeId === moderatorId);
        break;
      }
      case ReportTarget.RESOURCE: {
        const resource = await manager.findOne(Resource, {
          where: { id: report.targetId },
        });
        involved = resource?.ownerId === moderatorId;
        break;
      }
      case ReportTarget.LOST_FOUND: {
        const lostFound = await manager.findOne(LostFoundReport, {
          where: { id: report.targetId },
        });
        involved = lostFound?.reporterId === moderatorId;
        break;
      }
    }
    if (involved) {
      throw new ForbiddenException('You cannot resolve a report involving your account');
    }
  }

  async resolveForTarget(
    manager: EntityManager,
    targetType: ReportTarget,
    targetId: string,
    moderatorId: string,
    note: string | null,
  ) {
    const reports = await manager.find(Report, {
      where: { targetType, targetId, status: ReportStatus.OPEN },
    });
    if (reports.some((report) => report.reporterId === moderatorId)) {
      throw new ForbiddenException(
        'You cannot hide content for a report you submitted',
      );
    }
    for (const report of reports) {
      await manager.update(
        Report,
        { id: report.id },
        {
          status: ReportStatus.RESOLVED,
          resolvedById: moderatorId,
          resolvedAt: new Date(),
          resolutionNote: note,
        },
      );
      await this.audit.record(manager, {
        actorId: moderatorId,
        action: 'report.resolved',
        targetType: 'report',
        targetId: report.id,
        metadata: { target: targetType, targetRef: targetId, note },
      });
    }
  }
  private async targetCampus(
    manager: EntityManager,
    type: ReportTarget,
    id: string,
  ): Promise<string | null> {
    const sql = {
      [ReportTarget.REVIEW]:
        'SELECT u.campus AS campus FROM reviews x JOIN resources r ON r.id = x.resourceId JOIN users u ON u.id = r.ownerId WHERE x.id = ?',
      [ReportTarget.RESOURCE]:
        'SELECT u.campus AS campus FROM resources r JOIN users u ON u.id = r.ownerId WHERE r.id = ?',
      [ReportTarget.LOST_FOUND]: 'SELECT campus FROM lost_found_reports WHERE id = ?',
    }[type];
    const [row] = await manager.query(sql, [id]);
    return row?.campus ?? null;
  }

  async assertInCampus(
    manager: EntityManager,
    actorId: string,
    actorRole: string,
    type: ReportTarget,
    id: string,
  ) {
    if (actorRole === UserRole.ADMIN) return;
    if (actorRole !== UserRole.MODERATOR) return;

    const actor = await manager.findOne(User, {
      where: { id: actorId },
      select: { id: true, campus: true },
    });
    const campus = await this.targetCampus(manager, type, id);
    if (!actor || campus !== actor.campus) {
      throw new NotFoundException('Not found');
    }
  }
}
