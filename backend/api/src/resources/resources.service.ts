import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Brackets, DataSource, EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { Resource, ItemCondition } from './entities/resource.entity.js';
import { ResourceCategory } from './entities/resource-category.entity.js';
import { ResourceImage } from './entities/resource-image.entity.js';
import { ResourceFavorite } from './entities/resource-favorite.entity.js';
import { User } from '../users/entities/user.entity.js';
import {
  BorrowRequest,
  BorrowStatus,
  OCCUPYING_STATUSES,
} from '../borrow-requests/entities/borrow-request.entity.js';
import { CreateResourceDto } from './dto/create-resource.dto.js';
import { UpdateResourceDto } from './dto/update-resource.dto.js';
import { ListResourcesQueryDto } from './dto/list-resources-query.dto.js';
import { ImageStorageService } from './storage/image-storage.service.js';
import { detectImageType } from './storage/image-type.js';
import type { UploadedImageFile } from './storage/uploaded-file.js';
import { LoanEventType } from '../borrow-requests/entities/loan-event.entity.js';
import { recordLoanEvent } from '../borrow-requests/loan-events.js';
import { ReportsService } from '../reports/reports.service.js';
import { ReportTarget } from '../reports/entities/report.entity.js';
export const MAX_IMAGES_PER_RESOURCE = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Must match the statuses that occupy a resource (see borrow_requests.activeResourceId).
const ON_LOAN_SQL = `EXISTS (SELECT 1 FROM borrow_requests b WHERE b.resourceId = r.id AND b.status IN ('approved','active'))`;

const imageUrl = (key: string) => `/api/resources/images/${key}`;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

interface RawRow {
  id: string;
  title: string;
  description: string | null;
  borrowingRules?: string | null;
  pickupLocation: string | null;
  itemCondition: ItemCondition;
  maxLoanDays: number | string;
  isListed: number | string | boolean;
  createdAt: Date;
  ownerId: string;
  ownerName: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  onLoan: number | string;
  favorited: number | string;
  imageKey: string | null;
}

@Injectable()
export class ResourcesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: ImageStorageService,
    private readonly moderation: ReportsService,
  ) {}

  async report(userId: string, id: string, reason: string) {
    const resource = await this.dataSource.getRepository(Resource).findOne({ where: { id } });
    if (!resource || (!resource.isListed && resource.ownerId !== userId)) {
      throw new NotFoundException('Resource not found');
    }
    if (resource.ownerId === userId) {
      throw new BadRequestException('You cannot report your own listing');
    }

    await this.dataSource.transaction((manager) =>
      this.moderation.create(manager, userId, ReportTarget.RESOURCE, id, reason),
    );
    return { reported: true };
  }

  // ---------------- categories ----------------

  listCategories() {
    return this.dataSource.getRepository(ResourceCategory).find({ order: { name: 'ASC' } });
  }

  // ---------------- create / edit / delete ----------------

  async create(ownerId: string, dto: CreateResourceDto) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Title cannot be blank');
    await this.assertCategory(dto.categoryId);

    const repo = this.dataSource.getRepository(Resource);
    const saved = await repo.save(
      repo.create({
        ownerId,
        categoryId: dto.categoryId,
        title,
        description: dto.description?.trim() || null,
        itemCondition: dto.itemCondition ?? ItemCondition.GOOD,
        borrowingRules: dto.borrowingRules?.trim() || null,
        maxLoanDays: dto.maxLoanDays ?? 7,
        pickupLocation: dto.pickupLocation?.trim() || null,
        isListed: true,
      }),
    );
    return this.get(saved.id, ownerId);
  }

  async update(id: string, userId: string, dto: UpdateResourceDto) {
    if (dto.categoryId !== undefined) await this.assertCategory(dto.categoryId);

    await this.dataSource.transaction(async (m) => {
      const resource = await this.lockOwned(m, id, userId);

      if (dto.title !== undefined) {
        const t = dto.title.trim();
        if (!t) throw new BadRequestException('Title cannot be blank');
        resource.title = t;
      }
      if (dto.description !== undefined) resource.description = dto.description.trim() || null;
      if (dto.categoryId !== undefined) resource.categoryId = dto.categoryId;
      if (dto.itemCondition !== undefined) resource.itemCondition = dto.itemCondition;
      if (dto.borrowingRules !== undefined) resource.borrowingRules = dto.borrowingRules.trim() || null;
      if (dto.maxLoanDays !== undefined) resource.maxLoanDays = dto.maxLoanDays;
      if (dto.pickupLocation !== undefined) resource.pickupLocation = dto.pickupLocation.trim() || null;
      if (dto.isListed !== undefined) resource.isListed = dto.isListed;

      await m.save(resource);
    });

    return this.get(id, userId);
  }

  /** Soft delete. Blocked while an item is out; pending requests are cancelled. */
  async remove(id: string, userId: string) {
    return this.dataSource.transaction(async (m) => {
      await this.lockOwned(m, id, userId); // same lock order as the borrow workflow: resource first

      const occupying = await m.find(BorrowRequest, {
        select: { id: true },
        where: { resourceId: id, status: In(OCCUPYING_STATUSES) },
        lock: { mode: 'pessimistic_write' },
      });
      if (occupying.length > 0) {
        throw new ConflictException('Cannot delete a resource that is currently on loan');
      }

      const pending = await m.find(BorrowRequest, {
        select: { id: true },
        where: { resourceId: id, status: BorrowStatus.PENDING },
        lock: { mode: 'pessimistic_write' },
      });
      if (pending.length > 0) {
        await m.update(
          BorrowRequest,
          { id: In(pending.map((p) => p.id)) },
          { status: BorrowStatus.CANCELLED },
        );
        for (const p of pending) {
          await recordLoanEvent(m, {
            borrowRequestId: p.id,
            resourceId: id,
            actorId: userId,
            eventType: LoanEventType.CANCELLED,
            fromStatus: BorrowStatus.PENDING,
            toStatus: BorrowStatus.CANCELLED,
            note: 'Resource was removed by its owner',
          });
        }
      }
      await m.softDelete(Resource, id);
      return { deleted: true, cancelledPendingRequests: pending.length };
    });
  }

  // ---------------- read: search / filter / detail ----------------

  async list(userId: string, query: ListResourcesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const countRow = await this.applyFilters(this.baseQuery(), query, userId)
      .select('COUNT(*)', 'total')
      .getRawOne<{ total: string }>();
    const total = Number(countRow?.total ?? 0);

    const qb = this.select(this.applyFilters(this.baseQuery(), query, userId), userId, false);
    const sort = query.sort ?? 'newest';
    if (sort === 'title') qb.orderBy('r.title', 'ASC');
    else qb.orderBy('r.createdAt', sort === 'oldest' ? 'ASC' : 'DESC');
    qb.addOrderBy('r.id', 'ASC'); // stable pagination

    const rows = await qb.offset((page - 1) * limit).limit(limit).getRawMany<RawRow>();

    return { items: rows.map((r) => this.toDto(r)), total, page, limit };
  }

  async get(id: string, userId: string) {
    const row = await this.select(this.baseQuery(), userId, true)
      .where('r.deletedAt IS NULL')
      .andWhere('r.id = :id', { id })
      .getRawOne<RawRow>();

    // Hidden listings are only visible to their owner.
    if (!row || (!Boolean(Number(row.isListed)) && row.ownerId !== userId)) {
      throw new NotFoundException('Resource not found');
    }

    const images = await this.dataSource
      .getRepository(ResourceImage)
      .find({ where: { resourceId: id }, order: { sortOrder: 'ASC' } });

    return {
      ...this.toDto(row),
      images: images.map((i) => ({ id: i.id, url: imageUrl(i.storageKey), sortOrder: i.sortOrder })),
    };
  }

  // ---------------- images ----------------

  async addImages(resourceId: string, userId: string, files:UploadedImageFile[]) {
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');

    const detected = files.map((f, i) => {
      const t = detectImageType(f.buffer);
      if (!t) throw new BadRequestException(`File #${i + 1} is not a valid JPEG, PNG or WebP image`);
      return t;
    });

    const savedKeys: string[] = [];
    try {
      return await this.dataSource.transaction(async (m) => {
        await this.lockOwned(m, resourceId, userId); // lock makes the 5-image cap race-free

        const existing = await m.find(ResourceImage, { where: { resourceId } });
        if (existing.length + files.length > MAX_IMAGES_PER_RESOURCE) {
          throw new ConflictException(`A resource can have at most ${MAX_IMAGES_PER_RESOURCE} images`);
        }
        const nextOrder = existing.length ? Math.max(...existing.map((e) => e.sortOrder)) + 1 : 0;

        const rows: ResourceImage[] = [];
        for (let i = 0; i < files.length; i++) {
          const key = await this.storage.save(files[i].buffer, detected[i].ext);
          savedKeys.push(key);
          rows.push(
            m.create(ResourceImage, {
              resourceId,
              storageKey: key,
              mimeType: detected[i].mime,
              sizeBytes: files[i].size,
              sortOrder: nextOrder + i,
            }),
          );
        }
        await m.save(rows);
        return rows.map((r) => ({ id: r.id, url: imageUrl(r.storageKey), sortOrder: r.sortOrder }));
      });
    } catch (err) {
      await Promise.all(savedKeys.map((k) => this.storage.remove(k)));
      throw err;
    }
  }

  async removeImage(resourceId: string, imageId: string, userId: string) {
    const key = await this.dataSource.transaction(async (m) => {
      await this.lockOwned(m, resourceId, userId);
      const image = await m.findOne(ResourceImage, { where: { id: imageId, resourceId } });
      if (!image) throw new NotFoundException('Image not found');
      await m.delete(ResourceImage, { id: imageId });
      return image.storageKey;
    });
    await this.storage.remove(key);
    return { deleted: true };
  }

  // ---------------- favorites ----------------

  async addFavorite(userId: string, resourceId: string) {
    const resource = await this.dataSource.getRepository(Resource).findOne({ where: { id: resourceId } });
    if (!resource || (!resource.isListed && resource.ownerId !== userId)) {
      throw new NotFoundException('Resource not found');
    }
    // INSERT IGNORE: calling twice is harmless (idempotent).
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(ResourceFavorite)
      .values({ userId, resourceId })
      .orIgnore()
      .execute();
    return { favorited: true };
  }

  async removeFavorite(userId: string, resourceId: string) {
    await this.dataSource.getRepository(ResourceFavorite).delete({ userId, resourceId });
    return { favorited: false };
  }

  // ---------------- helpers ----------------

  private async assertCategory(categoryId: string) {
    const exists = await this.dataSource.getRepository(ResourceCategory).existsBy({ id: categoryId });
    if (!exists) throw new BadRequestException('Unknown category');
  }

  private async lockOwned(m: EntityManager, id: string, userId: string) {
    const resource = await m.findOne(Resource, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!resource) throw new NotFoundException('Resource not found');
    if (resource.ownerId !== userId) throw new ForbiddenException('Only the owner can do this');
    return resource;
  }

  private baseQuery() {
    return this.dataSource
      .createQueryBuilder()
      .from(Resource, 'r')
      .innerJoin(ResourceCategory, 'c', 'c.id = r.categoryId')
      .innerJoin(User, 'o', 'o.id = r.ownerId');
  }

  private applyFilters(qb: SelectQueryBuilder<Resource>, q: ListResourcesQueryDto, userId: string) {
    qb.where('r.deletedAt IS NULL');

    if (q.mine) qb.andWhere('r.ownerId = :me', { me: userId });
    else qb.andWhere('r.isListed = 1');

    if (q.category) qb.andWhere('c.slug = :slug', { slug: q.category });
    if (q.condition) qb.andWhere('r.itemCondition = :cond', { cond: q.condition });

    if (q.available) qb.andWhere('r.isListed = 1').andWhere(`NOT ${ON_LOAN_SQL}`);

    if (q.favorites) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM resource_favorites f2 WHERE f2.resourceId = r.id AND f2.userId = :me)',
        { me: userId },
      );
    }

    const text = q.q?.trim();
    if (text) {
      const like = `%${escapeLike(text)}%`;
      qb.andWhere(
        new Brackets((b) => {
          b.where('r.title LIKE :like', { like }).orWhere('r.description LIKE :like', { like });
        }),
      );
    }
    return qb;
  }

  private select(qb: SelectQueryBuilder<Resource>, userId: string, detail: boolean) {
    qb.select('r.id', 'id')
      .addSelect('r.title', 'title')
      .addSelect(detail ? 'r.description' : 'LEFT(r.description, 160)', 'description')
      .addSelect('r.itemCondition', 'itemCondition')
      .addSelect('r.maxLoanDays', 'maxLoanDays')
      .addSelect('r.pickupLocation', 'pickupLocation')
      .addSelect('r.isListed', 'isListed')
      .addSelect('r.createdAt', 'createdAt')
      .addSelect('r.ownerId', 'ownerId')
      .addSelect('o.name', 'ownerName') // name only: never expose email on public listings
      .addSelect('c.id', 'categoryId')
      .addSelect('c.name', 'categoryName')
      .addSelect('c.slug', 'categorySlug')
      .addSelect(ON_LOAN_SQL, 'onLoan')
      .addSelect(
        'EXISTS (SELECT 1 FROM resource_favorites f WHERE f.resourceId = r.id AND f.userId = :me)',
        'favorited',
      )
      .addSelect(
        '(SELECT i.storageKey FROM resource_images i WHERE i.resourceId = r.id ORDER BY i.sortOrder ASC LIMIT 1)',
        'imageKey',
      )
      .setParameter('me', userId);
    if (detail) qb.addSelect('r.borrowingRules', 'borrowingRules');
    return qb;
  }

  private toDto(row: RawRow) {
    const isListed = Boolean(Number(row.isListed));
    const onLoan = Boolean(Number(row.onLoan));
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: { id: row.categoryId, name: row.categoryName, slug: row.categorySlug },
      itemCondition: row.itemCondition,
      maxLoanDays: Number(row.maxLoanDays),
      pickupLocation: row.pickupLocation,
      ...(row.borrowingRules !== undefined ? { borrowingRules: row.borrowingRules } : {}),
      isListed,
      onLoan,
      available: isListed && !onLoan,
      favorited: Boolean(Number(row.favorited)),
      owner: { id: row.ownerId, name: row.ownerName },
      imageUrl: row.imageKey ? imageUrl(row.imageKey) : null,
      createdAt: row.createdAt,
    };
  }
}