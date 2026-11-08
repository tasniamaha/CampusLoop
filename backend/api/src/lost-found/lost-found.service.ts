import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import { ImageStorageService } from '../images/image-storage.service.js';
import { detectImageType } from '../images/image-type.js';
import { MAX_IMAGES_PER_ITEM } from '../images/image-limits.js';
import { sanitizeImage, type SanitizedImage } from '../images/sanitize-image.js';
import type { UploadedImageFile } from '../images/uploaded-file.js';
import { LostFoundPhoto } from './entities/lost-found-photo.entity.js';
import { canViewPhotos, canViewReport, type PhotoViewer } from './photo-access.js';
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

export const MAX_PHOTOS_PER_REPORT = MAX_IMAGES_PER_ITEM;
/** "My reports" returns at most this many of each list, newest first, plus a `truncated` flag. */
export const MY_LIST_LIMIT = 100;

const cleanText = (value: string) => value.trim().replace(/\s+/g, ' ');
// Same shape as resource image URLs; the web app loads it through its authenticated proxy.
const photoUrl = (reportId: string, photoId: string) => `/api/lost-found/${reportId}/photos/${photoId}`;

/**
 * `photosVisible` must come from canViewPhotos(). When false, both the photos and the legacy
 * imageUrl are withheld, and an empty list does not reveal whether the report has photos.
 */
const publicReport = (report: LostFoundReport, photos: LostFoundPhoto[], photosVisible: boolean) => ({
  id: report.id,
  type: report.type,
  title: report.title,
  description: report.description,
  category: report.category,
  location: report.location,
  itemDate: report.itemDate,
  /** @deprecated Read-only (phase 1 of retirement): no longer accepted on create. Use `photos`. */
  imageUrl: photosVisible ? report.imageUrl : null,
  photos: photosVisible ? photos.map((photo) => ({ id: photo.id, url: photoUrl(report.id, photo.id) })) : [],
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
    @InjectRepository(LostFoundPhoto)
    private readonly photos: Repository<LostFoundPhoto>,
    private readonly storage: ImageStorageService,
  ) {}

  private readonly logger = new Logger(LostFoundService.name);

  /** Campus and CURRENT role from the database; the role claim in the token may be stale. */
  private async getViewer(userId: string): Promise<PhotoViewer> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, campus: true, role: true },
    });
    if (!user) throw new NotFoundException('Account not found');
    return { id: user.id, campus: user.campus, role: user.role };
  }

  private async getCampus(userId: string): Promise<string> {
    return (await this.getViewer(userId)).campus;
  }

  /** Photos grouped by report, in display order. Only call it for reports the viewer may see. */
  private async photosFor(reportIds: string[]): Promise<Map<string, LostFoundPhoto[]>> {
    const byReport = new Map<string, LostFoundPhoto[]>();
    if (!reportIds.length) return byReport;
    const rows = await this.photos.find({
      where: { reportId: In(reportIds) },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    for (const row of rows) {
      const list = byReport.get(row.reportId) ?? [];
      list.push(row);
      byReport.set(row.reportId, list);
    }
    return byReport;
  }

  /** Response objects for reports, with photos only where canViewPhotos allows. */
  private async withPhotos(reports: LostFoundReport[], viewer: PhotoViewer) {
    const visible = new Set(reports.filter((r) => canViewPhotos(r, viewer)).map((r) => r.id));
    const photos = await this.photosFor([...visible]);
    return reports.map((r) => publicReport(r, photos.get(r.id) ?? [], visible.has(r.id)));
  }

  async list(userId: string, query: ListLostFoundQueryDto) {
    const viewer = await this.getViewer(userId);
    const { campus } = viewer;
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

    const data = await this.withPhotos(rows, viewer);
    return {
      data: data.map((item, i) => ({ ...item, isMine: rows[i].reporterId === userId })),
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
      imageUrl: null, // retired: photos are uploaded to POST /lost-found/:id/photos
      status: LostFoundStatus.OPEN,
      resolvedAt: null,
    });
    return publicReport(await this.reports.save(report), [], true);
  }

  /**
   * One report, for its own page. Visibility: canViewReport (404 otherwise, so existence is not
   * revealed). Photos still follow canViewPhotos. `myClaim` is the viewer's own claim, without the
   * private proof details, or null; other people's claims are never included.
   */
  /**
   * The caller's own lost-and-found activity. Built only from rows they own: reports they filed
   * (any status) and claims they filed. Never includes other people's claims, and never proof
   * details (not even the caller's own, same as `myClaim`). Claimed reports carry photos only
   * where canViewPhotos allows, so a claimant never sees a found item's photos here either.
   */
  async mine(userId: string) {
    const viewer = await this.getViewer(userId);
    const [filed, filedTotal] = await this.reports.findAndCount({
      where: { reporterId: viewer.id },
      order: { createdAt: 'DESC' },
      take: MY_LIST_LIMIT,
    });
    const [claims, claimsTotal] = await this.claims.findAndCount({
      where: { claimantId: viewer.id },
      order: { createdAt: 'DESC' },
      take: MY_LIST_LIMIT,
    });

    const claimed = claims.length
      ? await this.reports.find({ where: { id: In([...new Set(claims.map((c) => c.reportId))]) } })
      : [];
    const [filedResponses, claimedResponses] = await Promise.all([
      this.withPhotos(filed, viewer),
      this.withPhotos(claimed, viewer),
    ]);
    const claimedById = new Map(claimedResponses.map((r) => [r.id, r]));

    return {
      reports: {
        items: filedResponses.map((r) => ({ ...r, isMine: true })),
        truncated: filedTotal > MY_LIST_LIMIT,
      },
      claims: {
        items: claims.flatMap((claim) => {
          const report = claimedById.get(claim.reportId);
          return report ? [{ claim: this.claimResponse(claim), report: { ...report, isMine: false } }] : [];
        }),
        truncated: claimsTotal > MY_LIST_LIMIT,
      },
    };
  }

  async get(id: string, userId: string) {
    const viewer = await this.getViewer(userId);
    const report = await this.reports.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Lost-and-found report not found');
    const myClaim =
      report.reporterId === viewer.id
        ? null
        : await this.claims.findOne({ where: { reportId: id, claimantId: viewer.id } });
    if (!canViewReport(report, viewer, myClaim !== null)) {
      throw new NotFoundException('Lost-and-found report not found');
    }
    const [response] = await this.withPhotos([report], viewer);
    return {
      ...response,
      isMine: report.reporterId === viewer.id,
      myClaim: myClaim ? this.claimResponse(myClaim) : null,
    };
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
    const viewer = await this.getViewer(userId);
    const { campus } = viewer;
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

    const eligible = candidates.filter((candidate) => candidate.id !== report.id && candidate.reporterId !== userId);
    // Matching a LOST report surfaces FOUND reports: their photos must stay hidden here too.
    const responses = new Map((await this.withPhotos(eligible, viewer)).map((r) => [r.id, r]));
    return eligible
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
        return { report: responses.get(candidate.id)!, score, reasons };
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
    const photos = await this.photosFor([report.id]);
    return publicReport(report, photos.get(report.id) ?? [], true);
  }

  // ---------------- photos ----------------

  /** Locks the caller's own report. Someone else's report is reported as not found. */
  private async lockOwnReport(m: EntityManager, reportId: string, viewer: PhotoViewer) {
    const report = await m.findOne(LostFoundReport, {
      where: { id: reportId, campus: viewer.campus },
      lock: { mode: 'pessimistic_write' },
    });
    if (!report || report.reporterId !== viewer.id) {
      throw new NotFoundException('Lost-and-found report not found');
    }
    return report;
  }

  async addPhotos(reportId: string, userId: string, files: UploadedImageFile[]) {
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');
    const detected = files.map((file, i) => {
      const type = detectImageType(file.buffer);
      if (!type) throw new BadRequestException(`File #${i + 1} is not a supported image. Please use JPG, PNG or WebP.`);
      return type;
    });

    const viewer = await this.getViewer(userId);
    // Cheap ownership check first, so nobody can make the server re-encode images for a report that isn't theirs.
    const owned = await this.reports.findOne({ where: { id: reportId, campus: viewer.campus } });
    if (!owned || owned.reporterId !== viewer.id) throw new NotFoundException('Lost-and-found report not found');

    // Strip metadata before anything touches disk. Sequential to bound memory.
    const clean: SanitizedImage[] = [];
    for (let i = 0; i < files.length; i++) {
      clean.push(await sanitizeImage(files[i].buffer, detected[i], `File #${i + 1}`));
    }

    // 1) write the files, 2) insert the rows in one transaction, 3) delete the files if that fails.
    const savedKeys: string[] = [];
    try {
      for (const image of clean) savedKeys.push(await this.storage.save('lost-found', image.buffer, image.ext));

      const rows = await this.dataSource.transaction(async (m) => {
        // The lock serialises concurrent uploads, which keeps the photo cap exact.
        const report = await this.lockOwnReport(m, reportId, viewer);
        if (report.status !== LostFoundStatus.OPEN) {
          throw new ConflictException('Photos can only be added to open reports');
        }
        const existing = await m.find(LostFoundPhoto, { where: { reportId } });
        if (existing.length + clean.length > MAX_PHOTOS_PER_REPORT) {
          throw new ConflictException(`A report can have at most ${MAX_PHOTOS_PER_REPORT} photos`);
        }
        const nextOrder = existing.length ? Math.max(...existing.map((e) => e.sortOrder)) + 1 : 0;
        return m.save(
          clean.map((image, i) =>
            m.create(LostFoundPhoto, {
              reportId,
              storageKey: savedKeys[i],
              mimeType: image.mime,
              sizeBytes: image.buffer.length,
              sortOrder: nextOrder + i,
            }),
          ),
        );
      });
      return rows.map((row) => ({ id: row.id, url: photoUrl(reportId, row.id) }));
    } catch (err) {
      await Promise.all(savedKeys.map((key) => this.storage.remove('lost-found', key)));
      throw err;
    }
  }

  async removePhoto(reportId: string, photoId: string, userId: string) {
    const viewer = await this.getViewer(userId);
    const key = await this.dataSource.transaction(async (m) => {
      await this.lockOwnReport(m, reportId, viewer);
      const photo = await m.findOne(LostFoundPhoto, { where: { id: photoId, reportId } });
      if (!photo) throw new NotFoundException('Photo not found');
      await m.delete(LostFoundPhoto, { id: photo.id });
      return photo.storageKey;
    });
    // After commit: a rolled-back delete must never lose the file.
    await this.storage.remove('lost-found', key);
    return { deleted: true };
  }

  /**
   * Resolves a photo for the access-checked endpoint. Anything the viewer may not see is a 404,
   * so the response does not reveal whether a hidden report has photos.
   */
  async photoFile(reportId: string, photoId: string, userId: string): Promise<{ path: string; mime: string }> {
    const viewer = await this.getViewer(userId);
    const report = await this.reports.findOne({ where: { id: reportId } });
    if (!report || !canViewPhotos(report, viewer)) throw new NotFoundException('Photo not found');
    const photo = await this.photos.findOne({ where: { id: photoId, reportId } });
    const path = photo ? this.storage.pathFor('lost-found', photo.storageKey) : null;
    if (!photo || !path) {
      if (photo) this.logger.error(`Photo ${photo.id} has an invalid storage key`);
      throw new NotFoundException('Photo not found');
    }
    return { path, mime: photo.mimeType };
  }
}
