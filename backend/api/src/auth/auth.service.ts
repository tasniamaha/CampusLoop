import { Logger } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';
import { EmailVerificationService } from '../verification/email-verification.service.js';
import { PasswordResetService } from '../verification/password-reset.service.js';
import type { User } from '../users/entities/user.entity.js';
import { RefreshTokenService, type IssuedRefreshToken } from './refresh-token.service.js';
import { RefreshRevokeReason } from './entities/refresh-token.entity.js';

export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const ACCOUNT_DEACTIVATED = 'This account has been deactivated.';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly verification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}
    private readonly logger = new Logger(AuthService.name);

  async login(dto: LoginDto, userAgent: string | null = null) {
    const user = await this.usersService.findByEmailWithPassword(
      dto.email,
    );

    if (!user) {
          this.logger.warn('login failed: no user for that email');
           throw new UnauthorizedException('Invalid email or password');

    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      this.logger.warn(`login failed: wrong password for user ${user.id}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Checked after the password, so this message never reveals whether an email is registered.
    if (user.deactivatedAt) {
      this.logger.warn(`login refused: user ${user.id} is deactivated`);
      throw new UnauthorizedException(ACCOUNT_DEACTIVATED);
    }

    const refresh = await this.refreshTokens.issueForLogin(user.id, userAgent);
    return this.buildSession(user, refresh);
  }

  /** Rotates the refresh token and re-reads the user, so role changes apply on next refresh. */
  async refresh(rawRefreshToken: string, userAgent: string | null) {
    const { userId, token } = await this.refreshTokens.rotate(rawRefreshToken, userAgent);
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Session expired. Please log in again.');
    // Deactivation revokes refresh tokens; this also covers a rotation that raced with it.
    if (user.deactivatedAt) throw new UnauthorizedException(ACCOUNT_DEACTIVATED);
    return this.buildSession(user, token);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokens.revokeFamilyOf(rawRefreshToken);
  }

  /** Revokes every refresh token. Already-issued access tokens stay valid until they expire (≤15 min). */
  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId, RefreshRevokeReason.LOGOUT_ALL);
  }

  private async buildSession(user: User, refresh: IssuedRefreshToken) {
    const payload = { sub: user.id, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });

    return {
      accessToken,
      tokenType: 'Bearer' as const,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.expiresAt.toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        campus: user.campus,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
      },
    };
  }
  async getProfile(userId: string) {
      const user = await this.usersService.findById(userId);

      if (!user) {
          throw new UnauthorizedException('User no longer exists');
      }

      return {
          id: user.id,
          name: user.name,
          email: user.email,
          campus: user.campus,
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt,
          createdAt: user.createdAt,
      };
  }
async verifyEmail(token: string) {
  await this.verification.consume(token);
  return { verified: true };
}

async resendVerification(userId: string) {
  const user = await this.usersService.findById(userId);
  if (user && !user.emailVerifiedAt) await this.verification.sendFor(user);
  // Same answer whether or not a mail was sent (already verified, or hourly cap reached).
  return { message: 'If your email is not verified yet, a new link is on its way.' };
}
  async forgotPassword(email: string) {
    // Not awaited: response time is the same whether or not the email exists.
    void this.passwordReset
      .requestReset(email)
      .catch((err: Error) => this.logger.error(`Password reset request failed: ${err.message}`));
    return { message: 'If that email has an account, a reset link is on its way.' };
  }

  async resetPassword(token: string, password: string) {
    await this.passwordReset.reset(token, password);
    return { reset: true };
  }
}
