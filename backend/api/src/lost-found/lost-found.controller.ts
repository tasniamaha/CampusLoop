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
import type { Request } from 'express';
import { RequireVerifiedEmail } from '../auth/require-verified-email.decorator.js';
import { Throttle } from '@nestjs/throttler';
import { CreateLostFoundReportDto } from './dto/create-lost-found-report.dto.js';
import { CreateLostFoundClaimDto } from './dto/create-lost-found-claim.dto.js';
import { ReviewLostFoundClaimDto } from './dto/review-lost-found-claim.dto.js';
import { ListLostFoundQueryDto } from './dto/list-lost-found-query.dto.js';
import { LostFoundService } from './lost-found.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

@Controller('lost-found')
export class LostFoundController {
  constructor(private readonly service: LostFoundService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: ListLostFoundQueryDto) {
    return this.service.list(req.user.sub, query);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @RequireVerifiedEmail()
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateLostFoundReportDto) {
    return this.service.create(req.user.sub, dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @RequireVerifiedEmail()
  @Post(':id/claims')
  submitClaim(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateLostFoundClaimDto,
  ) {
    return this.service.submitClaim(id, req.user.sub, dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get(':id/claims')
  listClaims(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.listClaims(id, req.user.sub);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @RequireVerifiedEmail()
  @Patch('claims/:claimId/review')
  reviewClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ReviewLostFoundClaimDto,
  ) {
    return this.service.reviewClaim(claimId, req.user.sub, dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get(':id/matches')
  matches(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.matches(id, req.user.sub);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @RequireVerifiedEmail()
  @Patch(':id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.resolve(id, req.user.sub);
  }
}
