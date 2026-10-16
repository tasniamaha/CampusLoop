import { IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @Length(20, 200)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;
}