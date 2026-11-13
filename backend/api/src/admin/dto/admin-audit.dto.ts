import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

/** Filters shared by the audit-log viewer and the audit-log CSV export. */
export class AuditFilters {
  /** Exact action, e.g. "user.role_changed". */
  @IsOptional() @MaxLength(60) @Matches(/^[a-z_]+(\.[a-z_]+)*$/, { message: 'action must look like "user.role_changed"' }) action?: string;
  @IsOptional() @IsUUID() actorId?: string;
  /** Inclusive. A date (YYYY-MM-DD) means the start of that day, UTC. */
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  /** Inclusive. A date (YYYY-MM-DD) means the whole of that day, UTC. */
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}

export class ListAuditLogsQuery extends AuditFilters {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
