import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service.js';
import { User } from '../users/entities/user.entity.js';
import { VerificationToken, VerificationType } from './entities/verification-token.entity.js';
import { newOpaqueToken, sha256 } from './token.util.js';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly webUrl: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    const url = config.get<string>('WEB_URL');
    if (!url && config.get('NODE_ENV') === 'production') throw new Error('WEB_URL is required in production');
    this.webUrl = (url ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  /** Never reveals whether the email exists. Silently does nothing for unknown emails or over the hourly cap. */
  async requestReset(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.dataSource.getRepository(User).findOne({ where: { email } });
    if (!user) return;

    const raw = newOpaqueToken();
    const now = new Date();

    const allowed = await this.dataSource.transaction(async (m) => {
      await m.findOne(User, { where: { id: user.id }, lock: { mode: 'pessimistic_write' } });
      const recent = await m.count(VerificationToken, {
        where: {
          userId: user.id,
          type: VerificationType.PASSWORD_RESET,
          createdAt: MoreThan(new Date(now.getTime() - WINDOW_MS)),
        },
      });
      if (recent >= MAX_SENDS_PER_WINDOW) return false;

      // Only the newest link works.
      await m.update(
        VerificationToken,
        { userId: user.id, type: VerificationType.PASSWORD_RESET, usedAt: IsNull() },
        { usedAt: now },
      );
      await m.save(
        m.create(VerificationToken, {
          userId: user.id,
          type: VerificationType.PASSWORD_RESET,
          tokenHash: sha256(raw),
          expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
          usedAt: null,
          createdAt: now,
        }),
      );
      return true;
    });
    if (!allowed) return;

    const link = `${this.webUrl}/reset-password?token=${raw}`;
    try {
      await this.mail.send({
        to: user.email,
        subject: 'Reset your CampusLoop password',
        text:
          `Hi ${user.name},\n\nUse this link to choose a new password:\n${link}\n\n` +
          `It expires in 1 hour. If you did not ask for this, ignore this email.`,
      });
    } catch (err) {
      this.logger.error(`Reset email for user ${user.id} failed: ${(err as Error).message}`);
    }
  }

  async reset(raw: string, newPassword: string): Promise<void> {
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw new BadRequestException('Password must not exceed 72 bytes when encoded as UTF-8');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12); // outside the transaction: slow

    const ok = await this.dataSource.transaction(async (m) => {
      const token = await m.findOne(VerificationToken, {
        where: { tokenHash: sha256(raw), type: VerificationType.PASSWORD_RESET },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();
      if (!token || token.usedAt || token.expiresAt.getTime() <= now.getTime()) return false;

      await m.update(VerificationToken, { id: token.id }, { usedAt: now });
      await m.update(User, { id: token.userId }, { passwordHash });
      // Clicking the emailed link proves inbox ownership.
      await m.update(User, { id: token.userId, emailVerifiedAt: IsNull() }, { emailVerifiedAt: now });
      return true;
    });
    if (!ok) throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
  }
}