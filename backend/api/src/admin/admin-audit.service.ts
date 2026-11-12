import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ListAuditLogsQuery } from './dto/admin-audit.dto.js';

export interface AuditLogView {
  id: string;
  createdAt: Date;
  /** NULL = performed by the system (e.g. the admin:promote CLI, expiry sweeps). */
  actorId: string | null;
  /** The actor's current name and email; NULL for the system or a deleted account. */
  actor: { name: string; email: string } | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-01" -> start of that day; a full timestamp as given. */
const lowerBound = (value: string) => new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
/** "2026-11-01" -> start of the NEXT day (exclusive), so the whole day is included. */
const upperBound = (value: string): { at: Date; exclusive: boolean } =>
  DATE_ONLY.test(value)
    ? { at: new Date(new Date(`${value}T00:00:00.000Z`).getTime() + 86_400_000), exclusive: true }
    : { at: new Date(value), exclusive: false };

/** Read-only view of audit_logs for admins. Newest first; the table itself is append-only. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly dataSource: DataSource) {}

  async list(query: ListAuditLogsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.action) {
      where.push('a.action = ?');
      params.push(query.action);
    }
    if (query.actorId) {
      where.push('a.actorId = ?');
      params.push(query.actorId);
    }
    const from = query.from ? lowerBound(query.from) : null;
    const to = query.to ? upperBound(query.to) : null;
    if (from && to && from.getTime() >= to.at.getTime() + (to.exclusive ? 0 : 1)) {
      throw new BadRequestException('"from" must be before "to"');
    }
    if (from) {
      where.push('a.createdAt >= ?');
      params.push(from);
    }
    if (to) {
      where.push(to.exclusive ? 'a.createdAt < ?' : 'a.createdAt <= ?');
      params.push(to.at);
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, [count]] = await Promise.all([
      this.dataSource.query(
        `SELECT a.id, a.createdAt, a.actorId, a.action, a.targetType, a.targetId, a.metadata, a.ipAddress,
                u.name AS actorName, u.email AS actorEmail
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.actorId
           ${filter}
          ORDER BY a.createdAt DESC, a.id DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      ) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(`SELECT COUNT(*) AS total FROM audit_logs a ${filter}`, params) as Promise<Array<{ total: string | number }>>,
    ]);

    const total = Number(count.total);
    const data: AuditLogView[] = rows.map((row) => ({
      id: row.id as string,
      createdAt: row.createdAt as Date,
      actorId: (row.actorId as string | null) ?? null,
      actor: row.actorName ? { name: row.actorName as string, email: row.actorEmail as string } : null,
      action: row.action as string,
      targetType: row.targetType as string,
      targetId: (row.targetId as string | null) ?? null,
      metadata: typeof row.metadata === 'string' ? (JSON.parse(row.metadata) as Record<string, unknown>) : ((row.metadata as Record<string, unknown> | null) ?? null),
      ipAddress: (row.ipAddress as string | null) ?? null,
    }));
    return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
}
