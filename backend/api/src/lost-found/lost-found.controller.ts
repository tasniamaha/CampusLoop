import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { MAX_IMAGE_BYTES } from '../images/image-limits.js';
import type { UploadedImageFile } from '../images/uploaded-file.js';
import { RequireVerifiedEmail } from '../auth/require-verified-email.decorator.js';
import { Throttle } from '@nestjs/throttler';
import { CreateLostFoundReportDto } from './dto/create-lost-found-report.dto.js';
import { CreateLostFoundClaimDto } from './dto/create-lost-found-claim.dto.js';
import { ReviewLostFoundClaimDto } from './dto/review-lost-found-claim.dto.js';
import { ListLostFoundQueryDto } from './dto/list-lost-found-query.dto.js';
import { LostFoundService, MAX_PHOTOS_PER_REPORT } from './lost-found.service.js';
import { ReportContentDto } from '../reports/dto/reports.dto.js';

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

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @RequireVerifiedEmail()
  @Post(':id/report')
  report(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ReportContentDto,
  ) {
    return this.service.report(req.user.sub, id, dto.reason);
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

  // Per user (the default throttler tracks the authenticated user id). Each request may carry up to
  // the per-report cap; the web app sends one photo per request.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @RequireVerifiedEmail()
  @Post(':id/photos')
  @UseInterceptors(
    FilesInterceptor('files', MAX_PHOTOS_PER_REPORT, {
      limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_PHOTOS_PER_REPORT },
    }),
  )
  addPhotos(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @UploadedFiles() files: UploadedImageFile[],
  ) {
    return this.service.addPhotos(id, req.user.sub, files);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @RequireVerifiedEmail()
  @Delete(':id/photos/:photoId')
  removePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.removePhoto(id, photoId, req.user.sub);
  }

  // Authenticated on purpose (unlike resource images): found-item photos are private. Browsers load
  // it through the web app's /api/backend proxy, which attaches the token from the httpOnly cookie.
  // Higher limit than the default because one list page can show many thumbnails.
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Get(':id/photos/:photoId')
  @Header('Cache-Control', 'private, no-store')
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const { path, mime } = await this.service.photoFile(id, photoId, req.user.sub);
    try {
      await access(path);
    } catch {
      throw new NotFoundException('Photo not found');
    }
    return new StreamableFile(createReadStream(path), { type: mime, disposition: 'inline' });
  }
}
