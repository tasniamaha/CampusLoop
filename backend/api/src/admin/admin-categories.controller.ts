import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { CategoryNameDto } from './dto/admin-categories.dto.js';
import { AdminCategoriesService } from './admin-categories.service.js';
import type { Actor } from './admin-users.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

const actorOf = (req: AuthenticatedRequest): Actor => ({ id: req.user.sub, ip: req.ip ?? null });

/** Admin category management. No delete endpoint: categories are retired by deactivation. */
@Roles(UserRole.ADMIN)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly service: AdminCategoriesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CategoryNameDto) {
    return this.service.create(actorOf(req), dto.name);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Patch(':id')
  rename(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryNameDto) {
    return this.service.rename(actorOf(req), id, dto.name);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Patch(':id/deactivate')
  deactivate(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deactivate(actorOf(req), id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Patch(':id/reactivate')
  reactivate(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reactivate(actorOf(req), id);
  }
}
