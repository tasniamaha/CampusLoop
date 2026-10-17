import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage { to: string; subject: string; text: string; html?: string }

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly smtpEnabled: boolean;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    if (!host && config.get('NODE_ENV') === 'production') throw new Error('SMTP_HOST is required in production');
    this.smtpEnabled = Boolean(host);
    const user = config.get<string>('SMTP_USER');
    // Gmail overwrites From with the authenticated account anyway; be honest about it.
    this.from =
      host === 'smtp.gmail.com' && user
        ? `CampusLoop <${user}>`
        : (config.get<string>('MAIL_FROM') ?? 'CampusLoop <no-reply@campusloop.local>');

    if (host) {
      const port = Number(config.get('SMTP_PORT') ?? 587);
      this.transport = createTransport({
        host, port,
        secure: port === 465,
        requireTLS: port !== 465,          // never fall back to plaintext
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
        auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
      });
    } else {
      this.transport = createTransport({ jsonTransport: true });
    }
  }

  /** Fail loudly in the logs at boot if credentials are wrong, not silently at first signup. */
  async onModuleInit() {
    if (!this.smtpEnabled) return;
    try {
      await this.transport.verify();
      this.logger.log('SMTP connection verified');
    } catch (err) {
      this.logger.error(`SMTP verify FAILED: ${(err as Error).message}`);
    }
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
    if (!this.smtpEnabled) {
      this.logger.log(`[SMTP not configured] to=${message.to} subject="${message.subject}"\n${message.text}`);
    }
  }
}