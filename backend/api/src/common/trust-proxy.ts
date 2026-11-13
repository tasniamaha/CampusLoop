import { isIP } from 'node:net';
import type { INestApplication } from '@nestjs/common';

const PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isAddressOrSubnet(entry: string): boolean {
  const [address, prefix, extra] = entry.split('/');
  const family = isIP(address);
  if (!family || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Turns TRUST_PROXY into the Express "trust proxy" list: the peers whose X-Forwarded-For is believed.
 * Only named ranges (loopback, linklocal, uniquelocal) and IP addresses or CIDR subnets are allowed.
 * Hop counts and "true" are refused: they trust whoever connects, so a client reaching the API
 * directly could pick its own IP. Unset or empty means loopback (the Next server on this host);
 * "none" trusts nobody. Anything else stops the boot.
 */
export function parseTrustProxy(raw: string | undefined): string[] {
  const value = raw?.trim() ?? '';
  if (value === '') return ['loopback'];
  if (value.toLowerCase() === 'none') return [];
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const invalid = entries.filter((entry) => !PRESETS.has(entry.toLowerCase()) && !isAddressOrSubnet(entry));
  if (entries.length === 0 || invalid.length > 0) {
    throw new Error(
      `TRUST_PROXY must list proxy addresses, CIDR subnets or loopback/linklocal/uniquelocal (or be none); got: ${invalid.join(', ') || value}`,
    );
  }
  return entries.map((entry) => (PRESETS.has(entry.toLowerCase()) ? entry.toLowerCase() : entry));
}

/** Applies parseTrustProxy to the app. main.ts and the HTTP e2e tests share it, so req.ip behaves the same. */
export function applyTrustProxy(app: INestApplication, raw: string | undefined = process.env.TRUST_PROXY): void {
  app.getHttpAdapter().getInstance().set('trust proxy', parseTrustProxy(raw));
}
