import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BorrowRequest } from './entities/borrow-request.entity.js';
import { Resource } from '../resources/entities/resource.entity.js';
import { BorrowRequestsService } from './borrow-requests.service.js';
import { BorrowRequestsController } from './borrow-requests.controller.js';
import { LoanEvent } from './entities/loan-event.entity.js';
@Module({
  imports: [TypeOrmModule.forFeature([BorrowRequest, Resource, LoanEvent])],
  controllers: [BorrowRequestsController],
  providers: [BorrowRequestsService],
})
export class BorrowRequestsModule {}