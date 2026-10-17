import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateStudyGroupDto {
  @IsString() @MinLength(3) @MaxLength(120) title!: string;
  @IsString() @MinLength(2) @MaxLength(40) courseCode!: string;
  @IsString() @MinLength(2) @MaxLength(100) topic!: string;
  @IsString() @MinLength(10) @MaxLength(3000) description!: string;
  @IsString() @MinLength(2) @MaxLength(500) schedule!: string;
  @Type(() => Number) @IsInt() @Min(2) @Max(100) participantLimit!: number;
  @IsOptional() @IsBoolean() approvalRequired?: boolean;
}
