import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerateReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
