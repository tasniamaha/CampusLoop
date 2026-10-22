import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { ReportsService } from '../reports/reports.service.js';
import { ReportTarget } from '../reports/entities/report.entity.js';
import { CreateLostFoundReportDto } from './dto/create-lost-found-report.dto.js';
import { CreateLostFoundClaimDto } from './dto/create-lost-found-claim.dto.js';
import { ReviewLostFoundClaimDto } from './dto/review-lost-found-claim.dto.js';
import { LostFoundClaim, LostFoundClaimStatus } from './entities/lost-found-claim.entity.js';
import { ListLostFoundQueryDto } from './dto/list-lost-found-query.dto.js';
import {
  LostFoundReport,
  LostFoundStatus,
  LostFoundType,
} from './entities/lost-found-report.entity.js';

const cleanText = (value: string) => value.trim().replace(/\s+/g, ' ');
const publicReport = (report: LostFoundReport) => ({
  id: report.id,
  type: report.type,
  title: report.title,
  description: report.description,
  category: report.category,
  location: report.location,
  itemDate: report.itemDate,
  imageUrl: report.imageUrl,
  status: report.status,
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
});

@Injectable()
export class LostFoundService {
  constructor(
    @InjectRepository(LostFoundReport)
    private readonly reports: Repository<LostFoundReport>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(LostFoundClaim)
    private readonly claims: Repository<LostFoundClaim>,
    private readonly dataSource: DataSource,
    private readonly moderation: ReportsService,
  ) {}

  private async getCampus(userId: string): Promise<string> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, campus: true },
    });
    if (!user) throw new NotFoundException('Account not found');
    return user.campus;
  }

  async list(userId: string, query: ListLostFoundQueryDto) {
    const campus = await this.getCampus(userId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.reports.findAndCount({
      where: {
        campus,
        status: LostFoundStatus.OPEN,
        ...(query.type ? { type: query.type } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => ({ ...publicReport(row), isMine: row.reporterId === userId })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async create(userId: string, dto: CreateLostFoundReportDto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.itemDate) || Number.isNaN(Date.parse(`${dto.itemDate}T00:00:00Z`)) || new Date(`${dto.itemDate}T00:00:00Z`).toISOString().slice(0, 10) !== dto.itemDate) {
      throw new BadRequestException('Item date must be a valid calendar date');
    }
    const campus = await this.getCampus(userId);
    const itemDateMs = Date.parse(`${dto.itemDate}T00:00:00Z`);
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    if (itemDateMs > todayUtc.getTime()) {
      throw new BadRequestException('Item date cannot be in the future');
    }
    const report = this.reports.create({
      reporterId: userId,
      campus,
      type: dto.type,
      title: cleanText(dto.title),
      description: dto.description.trim(),
      category: cleanText(dto.category),
      location: cleanText(dto.location),
      itemDate: dto.itemDate,
      imageUrl: dto.imageUrl?.trim() || null,
      status: LostFoundStatus.OPEN,
      resolvedAt: null,
    });
    return publicReport(await this.reports.save(report));
  }

  async report(userId: string, id: string, reason: string) {
    const campus = await this.getCampus(userId);
    const notice = await this.reports.findOne({
      where: { id, campus, status: LostFoundStatus.OPEN },
    });
    if (!notice) throw new NotFoundException('Open lost-and-found report not found');
    if (notice.reporterId === userId) {
      throw new BadRequestException('You cannot report your own notice');
    }

    await this.dataSource.transaction((manager) =>
      this.moderation.create(manager, userId, ReportTarget.LOST_FOUND, id, reason),
    );
    return { reported: true };
  }

  async matches(id: string, userId: string) {
    const campus = await this.getCampus(userId);
    const report = await this.reports.findOne({ where: { id, campus, status: LostFoundStatus.OPEN } });
    if (!report) throw new NotFoundException('Open lost-and-found report not found');

    const oppositeType = report.type === LostFoundType.LOST
      ? LostFoundType.FOUND
      : LostFoundType.LOST;
    const candidates = await this.reports.find({
      where: {
        campus,
        type: oppositeType,
        status: LostFoundStatus.OPEN,
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    const words = (value: string) => new Set(
      value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3),
    );
    const reportWords = words(`${report.title} ${report.description}`);
    const reportDate = new Date(`${report.itemDate}T00:00:00Z`).getTime();

    return candidates
      .filter((candidate) => candidate.id !== report.id && candidate.reporterId !== userId)
      .map((candidate) => {
        const candidateWords = words(`${candidate.title} ${candidate.description}`);
        const sharedWords = [...reportWords].filter((word) => candidateWords.has(word)).length;
        const sameLocation = candidate.location.trim().toLocaleLowerCase() === report.location.trim().toLocaleLowerCase();
        const candidateDate = new Date(`${candidate.itemDate}T00:00:00Z`).getTime();
        const daysApart = Math.abs(reportDate - candidateDate) / 86_400_000;
        const sameCategory = candidate.category.trim().toLocaleLowerCase() === report.category.trim().toLocaleLowerCase();
        const score = Math.min(sharedWords * 15, 35)
          + (sameLocation ? 30 : 0)
          + (sameCategory ? 20 : 0)
          + (daysApart <= 1 ? 15 : daysApart <= 3 ? 8 : 0);
        const reasons = [
          ...(sharedWords ? ['Similar description keywords'] : []),
          ...(sameLocation ? ['Same reported location'] : []),
          ...(sameCategory ? ['Same category'] : []),
          ...(daysApart <= 3 ? ['Dates are within 3 days'] : []),
        ];
        return { report: publicReport(candidate), score, reasons };
      })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.report.createdAt).getTime() - new Date(a.report.createdAt).getTime());
  }

  async submitClaim(reportId: string, userId: string, dto: CreateLostFoundClaimDto) {
    const campus = await this.getCampus(userId);
    const report = await this.reports.findOne({
      where: { id: reportId, campus, status: LostFoundStatus.OPEN },
    });
    if (!report) throw new NotFoundException('Open campus lost-and-found report not found');
    if (report.type !== LostFoundType.FOUND) {
      throw new BadRequestException('Claims can only be submitted for found items');
    }
    if (report.reporterId === userId) {
      throw new BadRequestException('You cannot claim your own report');
    }
    const existing = await this.claims.findOne({ where: { reportId, claimantId: userId } });
    if (existing) throw new ConflictException('You have already submitted a claim for this item');

    const claim = this.claims.create({
      reportId,
      claimantId: userId,
      campus,
      proofDetails: dto.proofDetails.trim(),
      status: LostFoundClaimStatus.PENDING,
      reviewerNote: null,
      reviewedAt: null,
    });
    const saved = await this.claims.save(claim);
    return this.claimResponse(saved, true);
  }

  async listClaims(reportId: string, userId: string) {
    const campus = await this.getCampus(userId);
    const report = await this.reports.findOne({ where: { id: reportId, campus } });
    if (!report) throw new NotFoundException('Lost-and-found report not found');
    if (report.reporterId !== userId) {
      throw new ForbiddenException('Only the report creator can review claims');
    }
    const claims = await this.claims.find({
      where: { reportId, campus },
      order: { createdAt: 'DESC' },
    });
    return claims.map((claim) => this.claimResponse(claim, true));
  }

  async reviewClaim(claimId: string, userId: string, dto: ReviewLostFoundClaimDto) {
    const campus = await this.getCampus(userId);
    const claim = await this.claims.findOne({ where: { id: claimId, campus } });
    if (!claim) throw new NotFoundException('Claim not found');

    const report = await this.reports.findOne({ where: { id: claim.reportId, campus } });
    if (!report) throw new NotFoundException('Lost-and-found report not found');
    if (report.reporterId !== userId) {
      throw new ForbiddenException('Only the report creator can review claims');
    }
    if (claim.status !== LostFoundClaimStatus.PENDING) {
      throw new ConflictException('This claim has already been reviewed');
    }
    if (report.status !== LostFoundStatus.OPEN) {
      throw new ConflictException('This item is no longer open for claims');
    }

    claim.status = dto.status;
    claim.reviewerNote = dto.reviewerNote?.trim() || null;
    claim.reviewedAt = new Date();
    await this.claims.save(claim);

    if (dto.status === LostFoundClaimStatus.APPROVED) {
      report.status = LostFoundStatus.RESOLVED;
      report.resolvedAt = new Date();
      await this.reports.save(report);
      // Once ownership is verified, close any competing pending claims.
      const pendingClaims = await this.claims.find({
        where: { reportId: report.id, campus, status: LostFoundClaimStatus.PENDING },
      });
      if (pendingClaims.length) {
        const reviewedAt = new Date();
        await this.claims.save(pendingClaims.map((pending) => ({
          ...pending,
          status: LostFoundClaimStatus.REJECTED,
          reviewerNote: 'Another claim was approved for this item.',
          reviewedAt,
        })));
      }
    }
    return this.claimResponse(claim, true);
  }

  private claimResponse(claim: LostFoundClaim, includePrivateDetails = false) {
    return {
      id: claim.id,
      reportId: claim.reportId,
      status: claim.status,
      createdAt: claim.createdAt,
      reviewedAt: claim.reviewedAt,
      reviewerNote: claim.reviewerNote,
      ...(includePrivateDetails ? {
        claimantId: claim.claimantId,
        proofDetails: claim.proofDetails,
      } : {}),
    };
  }

  async resolve(id: string, userId: string) {
    const campus = await this.getCampus(userId);
    const report = await this.reports.findOne({ where: { id, campus } });
    if (!report) throw new NotFoundException('Lost-and-found report not found');
    if (report.reporterId !== userId) {
      throw new ForbiddenException('Only the person who created this report can resolve it');
    }
    if (report.status !== LostFoundStatus.RESOLVED) {
      report.status = LostFoundStatus.RESOLVED;
      report.resolvedAt = new Date();
      await this.reports.save(report);
    }
    return publicReport(report);
  }
}
