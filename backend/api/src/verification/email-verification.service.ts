import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { MailService } from '../mail/mail.service.js';
import { User } from '../users/entities/user.entity.js';
import { VerificationToken, VerificationType } from './entities/verification-token.entity.js';
import { newOpaqueToken, sha256 } from './token.util.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3; // per user, enforced in the DB so it survives restarts and multiple instances

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
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

  /** Returns false (and sends nothing) when this user already got MAX_SENDS_PER_WINDOW links in the last hour. */
  async sendFor(user: { id: string; email: string; name: string }): Promise<boolean> {
    const raw = newOpaqueToken();
    const now = new Date();

    const allowed = await this.dataSource.transaction(async (m) => {
      // Lock the user row so concurrent sends for one user are counted one at a time.
      await m.findOne(User, { where: { id: user.id }, lock: { mode: 'pessimistic_write' } });

      const recent = await m.count(VerificationToken, {
        where: {
          userId: user.id,
          type: VerificationType.EMAIL_VERIFY,
          createdAt: MoreThan(new Date(now.getTime() - WINDOW_MS)),
        },
      });
      if (recent >= MAX_SENDS_PER_WINDOW) return false;

      // Only the newest link works: retire older unused ones.
      await m.update(
        VerificationToken,
        { userId: user.id, type: VerificationType.EMAIL_VERIFY, usedAt: IsNull() },
        { usedAt: now },
      );
      await m.save(
        m.create(VerificationToken, {
          userId: user.id,
          type: VerificationType.EMAIL_VERIFY,
          tokenHash: sha256(raw),
          expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
          usedAt: null,
          createdAt: now,
        }),
      );
      return true;
    });
    if (!allowed) return false;

        const link = `${this.webUrl}/verify-email?token=${raw}`;
    try {
      await this.mail.send({
        to: user.email,
        subject: 'Confirm your CampusLoop email',
        text:
          `Hi ${user.name},\n\nConfirm your email address to start sharing on CampusLoop:\n${link}\n\n` +
          `This link expires in 24 hours. If you did not sign up, ignore this email.`,
        html:
          `<p>Hi ${escapeHtml(user.name)},</p>` +
          `<p><a href="${link}">Confirm your email address</a> to start sharing on CampusLoop.</p>` +
          `<p>This link expires in 24 hours. If you did not sign up, ignore this email.</p>`,
      });
    } catch (err) {
      this.logger.error(`Verification email for user ${user.id} failed: ${(err as Error).message}`);
      // Roll back: drop the undelivered token and revive the link we retired a moment ago.
      const repo = this.dataSource.getRepository(VerificationToken);
      await repo.delete({ tokenHash: sha256(raw) });
      await repo.update(
        { userId: user.id, type: VerificationType.EMAIL_VERIFY, usedAt: now },
        { usedAt: null },
      );
      return false;
    }
    return true;
  }

  async consume(raw: string): Promise<void> {
    const ok = await this.dataSource.transaction(async (m) => {
      const token = await m.findOne(VerificationToken, {
        where: { tokenHash: sha256(raw), type: VerificationType.EMAIL_VERIFY },
        lock: { mode: 'pessimistic_write' }, // two simultaneous clicks: one wins
      });
      const now = new Date();
      if (!token || token.usedAt || token.expiresAt.getTime() <= now.getTime()) return false;

      await m.update(VerificationToken, { id: token.id }, { usedAt: now });
      await m.update(User, { id: token.userId, emailVerifiedAt: IsNull() }, { emailVerifiedAt: now });
      return true;
    });
    if (!ok) {
      throw new BadRequestException(
        'This verification link is invalid or has expired. Log in and request a new one.',
      );
    }
  }
}