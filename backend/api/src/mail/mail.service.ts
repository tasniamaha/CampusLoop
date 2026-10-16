import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly smtpEnabled: boolean;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    if (!host && config.get('NODE_ENV') === 'production') {
      throw new Error('SMTP_HOST is required in production');
    }
    this.smtpEnabled = Boolean(host);
    this.from = config.get<string>('MAIL_FROM') ?? 'CampusLoop <no-reply@campusloop.local>';

    if (host) {
      const port = Number(config.get('SMTP_PORT') ?? 587);
      const user = config.get<string>('SMTP_USER');
      this.transport = createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
      });
    } else {
      this.transport = createTransport({ jsonTransport: true });
    }
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
    if (!this.smtpEnabled) {
      // Dev/test only: shows the verification link in the API console.
      this.logger.log(`[SMTP not configured] to=${message.to} subject="${message.subject}"\n${message.text}`);
    }
  }
}