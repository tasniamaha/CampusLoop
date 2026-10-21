
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { BorrowRequest } from '../borrow-requests/entities/borrow-request.entity.js';
import { Resource } from '../resources/entities/resource.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Review } from './entities/review.entity.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Review, BorrowRequest, Resource, User]),
    AuditModule,
    ReportsModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
