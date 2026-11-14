import { Controller, Get, Module, Req, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTrustProxy, parseTrustProxy } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it('defaults to loopback when unset or empty', () => {
    expect(parseTrustProxy(undefined)).toEqual(['loopback']);
    expect(parseTrustProxy('  ')).toEqual(['loopback']);
  });

  it('accepts presets, addresses and CIDR subnets', () => {
    expect(parseTrustProxy('Loopback, 10.0.0.0/8, 192.0.2.10, fd00::/8')).toEqual(['loopback', '10.0.0.0/8', '192.0.2.10', 'fd00::/8']);
  });

  it('none trusts nobody', () => {
    expect(parseTrustProxy('none')).toEqual([]);
  });

  it.each(['1', '2', 'true', 'TRUE', '*', 'all', '10.0.0.0/33', '10.0.0.0/8/1', 'loopback, 1', 'example.com', ','])(
    'refuses %j, which would trust whoever connects or is not an address',
    (raw) => {
      expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/);
    },
  );
});

@Controller()
class IpController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

@Module({ controllers: [IpController] })
class IpModule {}

describe('applyTrustProxy: what req.ip becomes (the value the audit log records)', () => {
  let app: INestApplication | undefined;

  async function start(raw: string | undefined) {
    const moduleRef = await Test.createTestingModule({ imports: [IpModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyTrustProxy(app, raw);
    await app.init();
    return (xff?: string) => {
      const req = request(app!.getHttpServer()).get('/ip');
      return (xff ? req.set('X-Forwarded-For', xff) : req).then((res) => (res.body as { ip: string }).ip);
    };
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('by default, believes the header from the local Next server (loopback)', async () => {
    const ipOf = await start(undefined);
    expect(await ipOf('198.51.100.7')).toBe('198.51.100.7');
  });

  it('takes the address next to the trusted proxy, so a client-written prefix is ignored', async () => {
    const ipOf = await start(undefined);
    expect(await ipOf('203.0.113.66, 198.51.100.7')).toBe('198.51.100.7');
  });

  it('ignores the header when the peer is not a configured proxy', async () => {
    const ipOf = await start('192.0.2.10');
    expect(await ipOf('198.51.100.7')).toMatch(/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/);
  });

  it('ignores the header with none', async () => {
    const ipOf = await start('none');
    expect(await ipOf('198.51.100.7')).toMatch(/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/);
  });
});
