import { Logger } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';
import { EmailVerificationService } from '../verification/email-verification.service.js';
import { PasswordResetService } from '../verification/password-reset.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly verification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,

  ) {}
    private readonly logger = new Logger(AuthService.name);

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(
      dto.email,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      sub: user.id,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
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
