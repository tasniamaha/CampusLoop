import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { ListReportsQuery, ResolveReportDto } from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

@Roles(UserRole.MODERATOR, UserRole.ADMIN)
@Controller('moderation/reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: ListReportsQuery) {
    return this.service.list(
      req.user.sub,
      req.user.role,
      query.status,
      query.page,
      query.limit,
    );
  }

  @Patch(':id/resolve')
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.service.resolve(req.user.sub, req.user.role, id, dto.status, dto.note);
  }
}
