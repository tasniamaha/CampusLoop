import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BorrowRequestsModule } from '../borrow-requests/borrow-requests.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MailModule } from '../mail/mail.module.js';
import { BorrowRequest } from '../borrow-requests/entities/borrow-request.entity.js';
import { Resource } from '../resources/entities/resource.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Notification } from './entities/notification.entity.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [forwardRef(() => BorrowRequestsModule), AuthModule, MailModule, TypeOrmModule.forFeature([Notification, BorrowRequest, Resource, User])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
