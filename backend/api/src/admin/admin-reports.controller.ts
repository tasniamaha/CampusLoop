import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { ListAuditLogsQuery } from './dto/admin-audit.dto.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminAnalyticsService } from './admin-analytics.service.js';

/** Read-only admin views: the audit log and the per-campus dashboard. Not campus-scoped. */
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminReportsController {
  constructor(
    private readonly audit: AdminAuditService,
    private readonly analytics: AdminAnalyticsService,
  ) {}

  @Get('audit-logs')
  auditLogs(@Query() query: ListAuditLogsQuery) {
    return this.audit.list(query);
  }

  @Get('analytics')
  dashboard() {
    return this.analytics.get();
  }
}
