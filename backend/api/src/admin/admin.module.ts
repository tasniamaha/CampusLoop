import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminAnalyticsService } from './admin-analytics.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminCategoriesController } from './admin-categories.controller.js';
import { AdminCategoriesService } from './admin-categories.service.js';
import { AdminExportsController } from './admin-exports.controller.js';
import { AdminExportsService } from './admin-exports.service.js';
import { AdminReportsController } from './admin-reports.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

/** Everything under /api/admin. Admin only (RolesGuard); every change is audited in its transaction. */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [AdminUsersController, AdminCategoriesController, AdminReportsController, AdminExportsController],
  providers: [AdminUsersService, AdminCategoriesService, AdminAuditService, AdminAnalyticsService, AdminExportsService],
})
export class AdminModule {}
