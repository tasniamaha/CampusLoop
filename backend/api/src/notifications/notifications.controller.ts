
import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import { NotificationsService } from './notifications.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('health')
  health() {
    return this.notifications.queueHealth();
  }

  @Post('test')
  test(@Req() req: AuthenticatedRequest) {
    return this.notifications.sendTestNotification(req.user.sub);
  }

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(req.user.sub, query);
  }

  @Get('unread-count')
  unreadCount(@Req() req: AuthenticatedRequest) {
    return this.notifications.unreadCount(req.user.sub);
  }

  @Patch('read-all')
  markAllRead(@Req() req: AuthenticatedRequest) {
    return this.notifications.markAllRead(req.user.sub);
  }

  @Patch(':id/read')
  markRead(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.markRead(req.user.sub, id);
  }

  @Delete(':id')
  deleteNotification(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.deleteNotification(req.user.sub, id);
  }
}
