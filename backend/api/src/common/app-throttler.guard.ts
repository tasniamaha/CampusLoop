import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const auth = req.headers?.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const digest = createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 24);
      return `u:${digest}`;
    }

    const email = req.body?.email;
    if (typeof email === 'string' && email.length <= 254) {
      return `e:${email.trim().toLowerCase()}`;
    }

    return `ip:${req.ip}`;
  }
}