import { Controller, Get } from '@nestjs/common';
import { ResourcesService } from './resources.service.js';

@Controller('resource-categories')
export class ResourceCategoriesController {
  constructor(private readonly service: ResourcesService) {}

  @Get()
  list() {
    return this.service.listCategories();
  }
}