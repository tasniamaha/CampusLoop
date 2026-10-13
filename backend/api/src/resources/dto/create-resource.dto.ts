import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ItemCondition } from '../entities/resource.entity.js';

export class CreateResourceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsEnum(ItemCondition)
  itemCondition?: ItemCondition;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  borrowingRules?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  maxLoanDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  pickupLocation?: string;
}