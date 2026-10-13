import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BorrowRequestsService } from './borrow-requests.service.js';
import { CreateBorrowRequestDto } from './dto/create-borrow-request.dto.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

@Controller('borrow-requests')
export class BorrowRequestsController {
  constructor(private readonly service: BorrowRequestsService) {}

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateBorrowRequestDto) {
    return this.service.create(req.user.sub, dto);
  }

  @Patch(':id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.approve(id, req.user.sub);
  }

  @Patch(':id/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.reject(id, req.user.sub);
  }

  @Patch(':id/return')
  markReturned(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.markReturned(id, req.user.sub);
  }
}