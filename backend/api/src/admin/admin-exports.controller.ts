import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { AuditFilters } from './dto/admin-audit.dto.js';
import { LoanFilters } from './dto/admin-exports.dto.js';
import { UserFilters } from './dto/admin-users.dto.js';
import { AdminExportsService, type CsvExport } from './admin-exports.service.js';
import type { Actor } from './admin-users.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

const actorOf = (req: AuthenticatedRequest): Actor => ({ id: req.user.sub, ip: req.ip ?? null });

/** Sends the file as a download that is never cached. */
function send(res: Response, file: CsvExport): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return file.csv;
}

/** Admin CSV exports. Each export is audit-logged (export.users, export.loans, export.audit_logs). */
@Roles(UserRole.ADMIN)
@Throttle({ default: { ttl: 60_000, limit: 10 } })
@Controller('admin/exports')
export class AdminExportsController {
  constructor(private readonly service: AdminExportsService) {}

  @Get('users.csv')
  async users(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response, @Query() filters: UserFilters) {
    return send(res, await this.service.users(actorOf(req), filters));
  }

  @Get('loans.csv')
  async loans(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response, @Query() filters: LoanFilters) {
    return send(res, await this.service.loans(actorOf(req), filters));
  }

  @Get('audit-logs.csv')
  async auditLogs(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response, @Query() filters: AuditFilters) {
    return send(res, await this.service.auditLog(actorOf(req), filters));
  }
}
