import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ItemCondition } from '../entities/resource.entity.js';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === 'true' || value === true;

export class ListResourcesQueryDto {
  /** Free-text search over title and description. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Category slug, e.g. "calculators". */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @IsEnum(ItemCondition)
  condition?: ItemCondition;

  /** true = listed AND not currently on loan. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  available?: boolean;

  /** true = only my own listings (including hidden ones). */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;

  /** true = only resources I favorited. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  favorites?: boolean;

  @IsOptional()
  @IsIn(['newest', 'oldest', 'title'])
  sort?: 'newest' | 'oldest' | 'title';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
