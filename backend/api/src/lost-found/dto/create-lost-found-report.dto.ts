import { IsDateString, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
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

  // imageUrl is no longer accepted (sending it is a 400 via forbidNonWhitelisted).
  // Photos are uploaded to POST /lost-found/:id/photos after the report is created.
}
