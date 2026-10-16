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
import { BorrowRequestsService } from './borrow-requests.service.js';
import { CreateBorrowRequestDto } from './dto/create-borrow-request.dto.js';
import { ListBorrowRequestsQueryDto } from './dto/list-borrow-requests-query.dto.js';
import { RequireVerifiedEmail } from '../auth/require-verified-email.decorator.js'; // CHANGED
import { QrTokenDto } from './dto/qr-token.dto.js';
interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

@Controller('borrow-requests')
export class BorrowRequestsController {
  constructor(private readonly service: BorrowRequestsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: ListBorrowRequestsQueryDto) {
    return this.service.list(req.user.sub, query);
  }

  @Get(':id/events')
  history(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.history(id, req.user.sub);
  }

  @RequireVerifiedEmail() // CHANGED
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateBorrowRequestDto) {
    return this.service.create(req.user.sub, dto);
  }

  @RequireVerifiedEmail() // CHANGED
  @Patch(':id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.approve(id, req.user.sub);
  }

  @RequireVerifiedEmail() // CHANGED
  @Patch(':id/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.reject(id, req.user.sub);
  }

  @RequireVerifiedEmail()
@Patch(':id/return')
confirmReturn(
  @Req() req: AuthenticatedRequest,
  @Param('id', new ParseUUIDPipe()) id: string,
  @Body() dto: QrTokenDto,
) {
  return this.service.confirmReturnWithQr(id, req.user.sub, dto.token);
}

  // Deliberately open: anyone can always back out of their own request.
  @Patch(':id/cancel')
  cancel(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.cancel(id, req.user.sub);
  }
  @Post(':id/pickup-qr')
@RequireVerifiedEmail()
createPickupQr(
  @Req() req: AuthenticatedRequest,
  @Param('id', new ParseUUIDPipe()) id: string,
) {
  return this.service.createPickupQr(id, req.user.sub);
}

@Post(':id/confirm-pickup')
@RequireVerifiedEmail()
confirmPickup(
  @Req() req: AuthenticatedRequest,
  @Param('id', new ParseUUIDPipe()) id: string,
  @Body() dto: QrTokenDto,
) {
  return this.service.confirmPickup(id, req.user.sub, dto.token);
}

@Post(':id/return-qr')
@RequireVerifiedEmail()
createReturnQr(
  @Req() req: AuthenticatedRequest,
  @Param('id', new ParseUUIDPipe()) id: string,
) {
  return this.service.createReturnQr(id, req.user.sub);
}
}