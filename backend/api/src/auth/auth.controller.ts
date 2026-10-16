import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { Public } from './public.decorator.js';
import { LoginThrottle } from '../common/login-throttle.js';
import { HttpCode } from '@nestjs/common';        // add to the existing @nestjs/common import
import { Throttle } from '@nestjs/throttler';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    role: string;
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.authService.getProfile(req.user.sub);
  }
  @LoginThrottle()
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Throttle({ 'mail-ip': { limit: 30, ttl: 3_600_000 } })
  @HttpCode(200)
  @Post('verify-email') // POST: mail scanners prefetch GET links and would burn the token
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Throttle({ 'mail-user': { limit: 3, ttl: 3_600_000 } })
  @HttpCode(202)
  @Post('resend-verification')
  resendVerification(@Req() req: AuthenticatedRequest) {
    return this.authService.resendVerification(req.user.sub);
  }
  @Public()
  @Throttle({ 'mail-ip': { limit: 10, ttl: 3_600_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ 'mail-ip': { limit: 30, ttl: 3_600_000 } })
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }
}