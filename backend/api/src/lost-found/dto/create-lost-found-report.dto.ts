import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LostFoundType } from '../entities/lost-found-report.entity.js';

export class CreateLostFoundReportDto {
  @IsEnum(LostFoundType)
  type!: LostFoundType;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(3000)
  description!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  category!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(180)
  location!: string;

  @IsDateString({ strict: true })
  itemDate!: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string;
}
