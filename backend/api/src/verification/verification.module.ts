import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module.js';
import { VerificationToken } from './entities/verification-token.entity.js';
import { EmailVerificationService } from './email-verification.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationToken]), MailModule],
  providers: [EmailVerificationService],
  exports: [EmailVerificationService],
})
export class VerificationModule {}