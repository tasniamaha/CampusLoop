import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLostFoundClaimDto {
  @IsString()
  @MinLength(20, { message: 'Please provide at least 20 characters of ownership evidence' })
  @MaxLength(2000)
  proofDetails!: string;
}
