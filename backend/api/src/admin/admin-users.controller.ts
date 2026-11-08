import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { ChangeRoleDto, ListUsersQuery } from './dto/admin-users.dto.js';
import { AdminUsersService, type Actor } from './admin-users.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

// req.ip honours Express "trust proxy" (see main.ts). Never read X-Forwarded-For by hand.
const actorOf = (req: AuthenticatedRequest): Actor => ({ id: req.user.sub, ip: req.ip ?? null });

/** Admin user management. RolesGuard checks the CURRENT role from the database on every call. */
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.service.list(query);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Patch(':id/role')
  changeRole(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeRoleDto) {
    return this.service.changeRole(actorOf(req), id, dto.role);
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
