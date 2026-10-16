import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';

// Number of reverse proxies YOU control in front of Next (nginx, a CDN, a platform edge).
// 0 = none: no inbound header can be trusted, so we send no client IP at all.
const TRUSTED_HOPS = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '0', 10) || 0;

export function getClientIp(request: NextRequest): string | null {
      //console.log('[client-ip]', { hops: TRUSTED_HOPS, xff: request.headers.get('x-forwarded-for') });
  if (TRUSTED_HOPS <= 0) return null;
  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = chain[chain.length - TRUSTED_HOPS]; // undefined if the chain is too short
  return candidate && isIP(candidate) ? candidate : null; // rejects junk and "ip:port" forms
}

/** Spread into fetch headers. Never forwards the browser's own header. */

export function forwardedForHeader(request: NextRequest): Record<string, string> {

  const ip = getClientIp(request);
  return ip ? { 'X-Forwarded-For': ip } : {};
}