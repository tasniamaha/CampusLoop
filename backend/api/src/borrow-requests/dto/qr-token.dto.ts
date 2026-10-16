import { IsString, MaxLength, MinLength } from 'class-validator';

export class QrTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  token!: string;
}