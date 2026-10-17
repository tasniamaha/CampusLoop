import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequireVerifiedEmail } from '../auth/require-verified-email.decorator.js';
import { Throttle } from '@nestjs/throttler';
import { CreateStudyGroupDto } from './dto/create-study-group.dto.js';
import { ListStudyGroupsQueryDto } from './dto/list-study-groups-query.dto.js';
import { ReviewStudyGroupMemberDto } from './dto/review-study-group-member.dto.js';
import { StudyGroupsService } from './study-groups.service.js';
interface AuthenticatedRequest extends Request { user: { sub: string; role: string } }
@Controller('study-groups')
export class StudyGroupsController {
  constructor(private readonly service: StudyGroupsService) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Query() query: ListStudyGroupsQueryDto) { return this.service.list(req.user.sub, query); }
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) @RequireVerifiedEmail() @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateStudyGroupDto) { return this.service.create(req.user.sub, dto); }
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) @RequireVerifiedEmail() @Post(':id/join')
  join(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.join(id, req.user.sub); }
  @Get(':id/members') members(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.listMembers(id, req.user.sub); }
  @Get(':id/requests') requests(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.listRequests(id, req.user.sub); }
  @Throttle({ default: { ttl: 60_000, limit: 20 } }) @RequireVerifiedEmail() @Patch(':id/members/:memberId')
  review(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string, @Body() dto: ReviewStudyGroupMemberDto) { return this.service.review(id, memberId, req.user.sub, dto.status); }
  @RequireVerifiedEmail() @Delete(':id/membership') leave(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.leave(id, req.user.sub); }
  @RequireVerifiedEmail() @Patch(':id/archive') archive(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.archive(id, req.user.sub); }
}
