import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { isDuplicateEntry } from '../common/db-errors.js';
import { ResourceCategory } from '../resources/entities/resource-category.entity.js';
import type { Actor } from './admin-users.service.js';

export interface AdminCategoryView {
  id: string;
  name: string;
  slug: string;
  deactivatedAt: Date | null;
  createdAt: Date;
  /** Resources (not deleted) that use this category. */
  resourceCount: number;
}

/** "Lab Kits & Tools" -> "lab-kits-tools". Accents are folded; anything else becomes a dash. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * Admin category management. There is deliberately no delete: resources reference categories
 * (ON DELETE RESTRICT), so a category is retired by deactivating it. Renaming keeps the slug, so
 * existing links and filters keep working. Every change is audited in its own transaction.
 */
@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminCategoryView[]> {
    const rows: Array<{ id: string; name: string; slug: string; deactivatedAt: Date | null; createdAt: Date; resourceCount: string | number }> =
      await this.dataSource.query(
        `SELECT c.id, c.name, c.slug, c.deactivatedAt, c.createdAt, COUNT(r.id) AS resourceCount
           FROM resource_categories c
           LEFT JOIN resources r ON r.categoryId = c.id AND r.deletedAt IS NULL
          GROUP BY c.id, c.name, c.slug, c.deactivatedAt, c.createdAt
          ORDER BY c.name ASC`,
      );
    return rows.map((row) => ({ ...row, resourceCount: Number(row.resourceCount) }));
  }

  async create(actor: Actor, name: string): Promise<AdminCategoryView> {
    const slug = slugify(name);
    if (!slug) throw new BadRequestException('The name must contain letters or digits');
    try {
      return await this.dataSource.transaction(async (m) => {
        const category = await m.save(m.create(ResourceCategory, { name, slug, deactivatedAt: null }));
        await this.audit.record(m, {
          actorId: actor.id,
          action: 'category.created',
          targetType: 'category',
          targetId: category.id,
          metadata: { name, slug },
          ipAddress: actor.ip,
        });
        return this.view(m, category.id);
      });
    } catch (err) {
      // The unique indexes on name and slug decide, so two concurrent creates can't both win.
      if (isDuplicateEntry(err)) throw new ConflictException('A category with this name already exists');
      throw err;
    }
  }

  async rename(actor: Actor, id: string, name: string): Promise<AdminCategoryView> {
    try {
      return await this.change(actor, id, async (m, category) => {
        if (category.name === name) throw new ConflictException('The category already has this name');
        const from = category.name;
        await m.update(ResourceCategory, { id }, { name });
        return { action: 'category.renamed', metadata: { from, to: name, slug: category.slug } };
      });
    } catch (err) {
      if (isDuplicateEntry(err)) throw new ConflictException('A category with this name already exists');
      throw err;
    }
  }

  deactivate(actor: Actor, id: string): Promise<AdminCategoryView> {
    return this.change(actor, id, async (m, category) => {
      if (category.deactivatedAt) throw new ConflictException('This category is already deactivated');
      await m.update(ResourceCategory, { id }, { deactivatedAt: new Date() });
      return { action: 'category.deactivated', metadata: { name: category.name } };
    });
  }

  reactivate(actor: Actor, id: string): Promise<AdminCategoryView> {
    return this.change(actor, id, async (m, category) => {
      if (!category.deactivatedAt) throw new ConflictException('This category is not deactivated');
      await m.update(ResourceCategory, { id }, { deactivatedAt: null });
      return { action: 'category.reactivated', metadata: { name: category.name } };
    });
  }

  /** Locks the category row, applies the change, and writes its audit row in the same transaction. */
  private change(
    actor: Actor,
    id: string,
    apply: (m: EntityManager, category: ResourceCategory) => Promise<{ action: string; metadata: Record<string, unknown> }>,
  ): Promise<AdminCategoryView> {
    return this.dataSource.transaction(async (m) => {
      const category = await m.findOne(ResourceCategory, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!category) throw new NotFoundException('Category not found');
      const { action, metadata } = await apply(m, category);
      await this.audit.record(m, { actorId: actor.id, action, targetType: 'category', targetId: id, metadata, ipAddress: actor.ip });
      return this.view(m, id);
    });
  }

  private async view(m: EntityManager, id: string): Promise<AdminCategoryView> {
    const [row] = (await m.query(
      `SELECT c.id, c.name, c.slug, c.deactivatedAt, c.createdAt,
              (SELECT COUNT(*) FROM resources r WHERE r.categoryId = c.id AND r.deletedAt IS NULL) AS resourceCount
         FROM resource_categories c WHERE c.id = ?`,
      [id],
    )) as Array<Omit<AdminCategoryView, 'resourceCount'> & { resourceCount: string | number }>;
    return { ...row, resourceCount: Number(row.resourceCount) };
  }
}
