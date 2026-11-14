import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LostFoundType } from '../entities/lost-found-report.entity.js';
import { LOST_FOUND_COLORS } from '../lost-found-attributes.js';

const lowerTrimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
/** A blank optional text field counts as not given. */
const trimmedOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value;

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

  /** The day, or the first day of the window. At most one day after today's UTC date. */
  @IsDateString({ strict: true })
  itemDate!: string;

  /** The last day of the window; omit for a single day. On or after itemDate, at most 30 days later. */
  @IsOptional()
  @IsDateString({ strict: true })
  itemDateTo?: string;

  @IsOptional()
  @Transform(lowerTrimmed)
  @IsIn(LOST_FOUND_COLORS)
  color?: string;

  /** Brand or make only. Serial numbers and engravings belong in claim proof. */
  @IsOptional()
  @Transform(trimmedOrUndefined)
  @IsString()
  @MaxLength(60)
  brand?: string;

  // imageUrl is no longer accepted (sending it is a 400 via forbidNonWhitelisted).
  // Photos are uploaded to POST /lost-found/:id/photos after the report is created.
}
