import 'reflect-metadata';
import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { canonicalEmail } from './email.js';

export const LOGIN_THROTTLE_KEY = 'campusloop:login-throttle';

/** Marks a handler as a credential-check endpoint (login). Enables the stricter login throttlers. */
export const LoginThrottle = () => SetMetadata(LOGIN_THROTTLE_KEY, true);

export const isLoginHandler = (ctx: ExecutionContext): boolean =>
  Reflect.getMetadata(LOGIN_THROTTLE_KEY, ctx.getHandler()) === true;

type Req = Record<string, any>;

// req.ip honours Express "trust proxy" (see main.ts). Never read X-Forwarded-For by hand.
const ipOf = (req: Req): string => req.ip ?? req.socket?.remoteAddress ?? 'unknown';

/**
 * Default bucket. `req.user` is only set by JwtAuthGuard AFTER it verified the signature,
 * so a forged or junk bearer token can never choose its own bucket.
 */
export const defaultTracker = (req: Req): string =>
  typeof req.user?.sub === 'string' ? `u:${req.user.sub}` : `ip:${ipOf(req)}`;

/** Per (client IP + target email): an attacker can only lock out their OWN pair, not the victim's. */
export const loginAccountTracker = (req: Req): string => {
  const raw = req.body?.email;
  const email = typeof raw === 'string' && raw.length <= 254 ? canonicalEmail(raw) : '-';  return `ip:${ipOf(req)}|e:${email}`;
};

/** Per client IP across all emails: stops one machine from spraying many accounts. */
export const loginIpTracker = (req: Req): string => `ip:${ipOf(req)}`;