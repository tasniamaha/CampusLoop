import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserRole } from '../../users/entities/user.entity.js';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Filters shared by the user list and the users CSV export. */
export class UserFilters {
  /** Matches anywhere in the name or email. */
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) campus?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsIn(['true', 'false']) verified?: 'true' | 'false';
  @IsOptional() @IsIn(['active', 'deactivated']) status?: 'active' | 'deactivated';
}

export class ListUsersQuery extends UserFilters {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}

export class ChangeRoleDto {
  @IsEnum(UserRole) role!: UserRole;
}
