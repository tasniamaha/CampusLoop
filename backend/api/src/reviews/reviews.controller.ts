import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { RequireVerifiedEmail } from '../auth/require-verified-email.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ModerateReviewDto } from './dto/moderate-review.dto.js';
import { ReportReviewDto } from './dto/report-review.dto.js';
import { ReviewsService } from './reviews.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequireVerifiedEmail()
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateReviewDto) {
    return this.service.create(req.user.sub, dto);
  }

  @Get('eligibility/:borrowRequestId')
  eligibility(
    @Req() req: AuthenticatedRequest,
    @Param('borrowRequestId', new ParseUUIDPipe()) borrowRequestId: string,
  ) {
    return this.service.getEligibility(borrowRequestId, req.user.sub);
  }

  @Get('resource/:resourceId')
  listForResource(
    @Req() req: AuthenticatedRequest,
    @Param('resourceId', new ParseUUIDPipe()) resourceId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listForResource(
      resourceId,
      req.user.sub,
      page === undefined ? 1 : Number(page),
      limit === undefined ? 10 : Number(limit),
    );
  }

  @Get('reputation/:userId')
  reputation(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.service.getReputation(userId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequireVerifiedEmail()
  @Post(':id/report')
  report(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReportReviewDto,
  ) {
    return this.service.report(req.user.sub, id, dto.reason);
  }

  @Roles(UserRole.MODERATOR, UserRole.ADMIN)
  @Patch(':id/hide')
  hide(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.service.setHidden(req.user.sub, req.user.role, id, true, dto.reason);
  }

  @Roles(UserRole.MODERATOR, UserRole.ADMIN)
  @Patch(':id/unhide')
  unhide(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.service.setHidden(req.user.sub, req.user.role, id, false, dto.reason);
  }
}
