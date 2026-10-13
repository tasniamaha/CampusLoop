import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BorrowStatus } from '../entities/borrow-request.entity.js';

export class ListBorrowRequestsQueryDto {
  /** incoming = requests for resources I own; outgoing = requests I made. */
  @IsIn(['incoming', 'outgoing'])
  role!: 'incoming' | 'outgoing';

  @IsOptional()
  @IsEnum(BorrowStatus)
  status?: BorrowStatus;

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