import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminUsersService, type Actor } from './admin-users.service.js';
import { toCsv, type CsvValue } from './csv.js';
import type { AuditFilters } from './dto/admin-audit.dto.js';
import type { LoanFilters } from './dto/admin-exports.dto.js';
import type { UserFilters } from './dto/admin-users.dto.js';

/** Exports larger than this are refused (422); the admin narrows the filters instead. */
export const EXPORT_ROW_LIMIT = 50_000;

export type ExportKind = 'users' | 'loans' | 'audit_logs';
export interface CsvExport {
  filename: string;
  csv: string;
  rowCount: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Admin CSV exports. Each one uses the same filters as the matching admin list, contains only the
 * fields an admin needs (never password or token hashes, claim proof details, loan messages or,
 * for the audit log, IP addresses), and is audit-logged with its filters and row count before it
 * is returned. An export that is refused (too large, invalid filters) writes no audit row.
 */
@Injectable()
export class AdminExportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly adminUsers: AdminUsersService,
    private readonly auditLogs: AdminAuditService,
  ) {}

  async users(actor: Actor, filters: UserFilters): Promise<CsvExport> {
    const { rows, total } = await this.adminUsers.findAll(filters, EXPORT_ROW_LIMIT);
    this.assertWithinLimit(total);
    const csv = toCsv(
      ['id', 'name', 'email', 'campus', 'role', 'email_verified_at', 'deactivated_at', 'created_at'],
      rows.map((u) => [u.id, u.name, u.email, u.campus, u.role, u.emailVerifiedAt, u.deactivatedAt, u.createdAt]),
    );
    return this.finish(actor, 'users', filters, csv, rows.length);
  }

  async loans(actor: Actor, filters: LoanFilters): Promise<CsvExport> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      where.push('br.status = ?');
      params.push(filters.status);
    }
    if (filters.campus) {
      where.push('owner.campus = ?');
      params.push(filters.campus);
    }
    const from = filters.from ? new Date(DATE_ONLY.test(filters.from) ? `${filters.from}T00:00:00.000Z` : filters.from) : null;
    const to = filters.to
      ? DATE_ONLY.test(filters.to)
        ? { at: new Date(Date.parse(`${filters.to}T00:00:00.000Z`) + 86_400_000), op: '<' }
        : { at: new Date(filters.to), op: '<=' }
      : null;
    if (from && to && from.getTime() >= to.at.getTime() + (to.op === '<' ? 0 : 1)) throw new BadRequestException('"from" must be before "to"');
    if (from) {
      where.push('br.createdAt >= ?');
      params.push(from);
    }
    if (to) {
      where.push(`br.createdAt ${to.op} ?`);
      params.push(to.at);
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Soft-deleted resources are included on purpose: their loans are still history.
    const from_ = `FROM borrow_requests br
                   JOIN resources r ON r.id = br.resourceId
                   JOIN resource_categories c ON c.id = r.categoryId
                   JOIN users owner ON owner.id = r.ownerId
                   JOIN users borrower ON borrower.id = br.borrowerId`;

    const [{ total }] = (await this.dataSource.query(`SELECT COUNT(*) AS total ${from_} ${filter}`, params)) as Array<{ total: string | number }>;
    this.assertWithinLimit(Number(total));
    const rows = (await this.dataSource.query(
      `SELECT br.id, r.id AS resourceId, r.title AS resourceTitle, c.name AS category,
              owner.email AS ownerEmail, borrower.email AS borrowerEmail, owner.campus AS campus,
              br.status, br.createdAt, br.approvedAt, br.dueDate
         ${from_} ${filter}
        ORDER BY br.createdAt DESC, br.id DESC`,
      params,
    )) as Array<Record<string, CsvValue>>;

    const csv = toCsv(
      ['id', 'resource_id', 'resource_title', 'category', 'owner_email', 'borrower_email', 'campus', 'status', 'created_at', 'approved_at', 'due_date'],
      rows.map((l) => [l.id, l.resourceId, l.resourceTitle, l.category, l.ownerEmail, l.borrowerEmail, l.campus, l.status, l.createdAt, l.approvedAt, l.dueDate]),
    );
    return this.finish(actor, 'loans', filters, csv, rows.length);
  }

  async auditLog(actor: Actor, filters: AuditFilters): Promise<CsvExport> {
    const { rows, total } = await this.auditLogs.findAll(filters, EXPORT_ROW_LIMIT);
    this.assertWithinLimit(total);
    // No IP addresses in the file: they stay visible in the admin viewer only.
    const csv = toCsv(
      ['id', 'created_at', 'actor_id', 'actor_email', 'action', 'target_type', 'target_id', 'metadata'],
      rows.map((a) => [a.id, a.createdAt, a.actorId, a.actor?.email ?? null, a.action, a.targetType, a.targetId, a.metadata ? JSON.stringify(a.metadata) : null]),
    );
    return this.finish(actor, 'audit_logs', filters, csv, rows.length);
  }

  private assertWithinLimit(total: number) {
    if (total > EXPORT_ROW_LIMIT) {
      throw new UnprocessableEntityException(
        `This export would have ${total} rows; the limit is ${EXPORT_ROW_LIMIT}. Narrow the filters and try again.`,
      );
    }
  }

  /** Writes the audit row (its own transaction) before the file is handed back. */
  private async finish(actor: Actor, kind: ExportKind, filters: object, csv: string, rowCount: number): Promise<CsvExport> {
    const used = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''));
    await this.dataSource.transaction((m) =>
      this.audit.record(m, {
        actorId: actor.id,
        action: `export.${kind}`,
        targetType: 'export',
        metadata: { filters: used, rowCount },
        ipAddress: actor.ip,
      }),
    );
    const date = new Date().toISOString().slice(0, 10);
    return { filename: `campusloop-${kind.replace('_', '-')}-${date}.csv`, csv, rowCount };
  }
}
