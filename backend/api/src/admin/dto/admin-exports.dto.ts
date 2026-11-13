import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { BorrowStatus } from '../../borrow-requests/entities/borrow-request.entity.js';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Filters for the loans CSV export. Dates filter on when the request was created. */
export class LoanFilters {
  @IsOptional() @IsEnum(BorrowStatus) status?: BorrowStatus;
  /** The resource owner's campus, exactly as stored. */
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) campus?: string;
  /** Inclusive. A date (YYYY-MM-DD) means the start of that day, UTC. */
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  /** Inclusive. A date (YYYY-MM-DD) means the whole of that day, UTC. */
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}
