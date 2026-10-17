import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { LostFoundClaimStatus } from '../entities/lost-found-claim.entity.js';

export class ReviewLostFoundClaimDto {
  @IsIn([LostFoundClaimStatus.APPROVED, LostFoundClaimStatus.REJECTED])
  status!: LostFoundClaimStatus.APPROVED | LostFoundClaimStatus.REJECTED;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewerNote?: string;
}
