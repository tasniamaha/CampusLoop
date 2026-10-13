import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { extname } from 'node:path';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_RESOURCE,
  ResourcesService,
} from './resources.service.js';
import { CreateResourceDto } from './dto/create-resource.dto.js';
import { UpdateResourceDto } from './dto/update-resource.dto.js';
import { ListResourcesQueryDto } from './dto/list-resources-query.dto.js';
import { ImageStorageService, MIME_BY_EXT } from './storage/image-storage.service.js';
import { Public } from '../auth/public.decorator.js';
import type { UploadedImageFile } from './storage/uploaded-file.js';
interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

@Controller('resources')
export class ResourcesController {
  constructor(
    private readonly service: ResourcesService,
    private readonly storage: ImageStorageService,
  ) {}

  // Public on purpose: <img src> requests from the browser cannot send the Bearer token
  // (it lives in an httpOnly cookie on the Next.js origin). Keys are unguessable UUIDs.
  @Public()
  @Get('images/:key')
  async image(@Param('key') key: string) {
    const path = this.storage.pathFor(key);
    if (!path) throw new NotFoundException();
    try {
      await access(path);
    } catch {
      throw new NotFoundException();
    }
    const mime = MIME_BY_EXT[extname(key).slice(1)] ?? 'application/octet-stream';
    return new StreamableFile(createReadStream(path), {
      type: mime,
      disposition: 'inline',
    });
  }

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: ListResourcesQueryDto) {
    return this.service.list(req.user.sub, query);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateResourceDto) {
    return this.service.create(req.user.sub, dto);
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id, req.user.sub);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateResourceDto,
  ) {
    return this.service.update(id, req.user.sub, dto);
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id, req.user.sub);
  }

  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('files', MAX_IMAGES_PER_RESOURCE, {
      limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_RESOURCE },
    }),
  )
  addImages(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFiles() files: UploadedImageFile[],
  ) {
    return this.service.addImages(id, req.user.sub, files);
  }

  @Delete(':id/images/:imageId')
  removeImage(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
  ) {
    return this.service.removeImage(id, imageId, req.user.sub);
  }

  @Put(':id/favorite')
  favorite(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.addFavorite(req.user.sub, id);
  }

  @Delete(':id/favorite')
  unfavorite(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.removeFavorite(req.user.sub, id);
  }
}