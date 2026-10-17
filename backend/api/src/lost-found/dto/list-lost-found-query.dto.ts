import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { LostFoundType } from '../entities/lost-found-report.entity.js';

export class ListLostFoundQueryDto {
  @IsOptional()
  @IsEnum(LostFoundType)
  type?: LostFoundType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
