import { IsString, Matches } from 'class-validator';

/** newOpaqueToken() = 32 random bytes, base64url = exactly 43 chars. */
export class RefreshTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'refreshToken is malformed' })
  refreshToken!: string;
}
