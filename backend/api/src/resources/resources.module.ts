import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resource } from './entities/resource.entity.js';
import { ResourceCategory } from './entities/resource-category.entity.js';
import { ResourceImage } from './entities/resource-image.entity.js';
import { ResourceFavorite } from './entities/resource-favorite.entity.js';
import { BorrowRequest } from '../borrow-requests/entities/borrow-request.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ResourcesService } from './resources.service.js';
import { ResourcesController } from './resources.controller.js';
import { ResourceCategoriesController } from './resource-categories.controller.js';
import { ImageStorageService } from './storage/image-storage.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Resource,
      ResourceCategory,
      ResourceImage,
      ResourceFavorite,
      BorrowRequest,
      User,
    ]),
  ],
  controllers: [ResourcesController, ResourceCategoriesController],
  providers: [ResourcesService, ImageStorageService],
})
export class ResourcesModule {}