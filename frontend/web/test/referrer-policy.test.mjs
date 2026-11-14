// Referrer-Policy: no-referrer on the two pages that carry a token in the URL (next.config.ts headers()).
// npm test (node --test with native type stripping; see ts-resolve.mjs).
//  - "config": runs headers() through Next's own route compiler, so it needs no build and runs everywhere.
//  - "built server": starts `next start` on the existing build and checks real responses. It needs
//    `npm run build` first. Locally it is skipped (with a message) when there is no build; when CI is
//    set it fails instead, so it can never silently skip there.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const { default: nextConfig } = await import('../next.config.ts');
const { buildCustomRoute } = await import('next/dist/lib/build-custom-route.js');

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_PAGES = ['/reset-password', '/verify-email'];
// Pages and routes that must keep the browser default (no Referrer-Policy header from us).
const OTHER_PATHS = ['/', '/login', '/forgot-password', '/dashboard', '/api/auth/reset-password', '/api/auth/verify-email'];

/** The Referrer-Policy value next.config.ts headers() assigns to `path`, or undefined (last match wins, as in Next). */
async function configuredPolicy(path) {
  let value;
  for (const route of await nextConfig.headers()) {
    const { regex } = buildCustomRoute('header', route);
    if (!new RegExp(regex).test(path)) continue;
    const header = route.headers.find((h) => h.key.toLowerCase() === 'referrer-policy');
    if (header) value = header.value;
  }
  return value;
}

describe('Referrer-Policy config', () => {
  for (const path of TOKEN_PAGES) {
    it(`${path} gets no-referrer`, async () => {
      assert.equal(await configuredPolicy(path), 'no-referrer');
    });
  }

  for (const path of OTHER_PATHS) {
    it(`${path} is not given a Referrer-Policy`, async () => {
      assert.equal(await configuredPolicy(path), undefined);
    });
  }

  it('does not match nested or look-alike paths', async () => {
    for (const path of ['/reset-password/x', '/verify-email/x', '/reset-password-old', '/x/verify-email']) {
      assert.equal(await configuredPolicy(path), undefined, path);
    }
  });
});

const hasBuild = existsSync(join(WEB_DIR, '.next', 'BUILD_ID'));
const inCi = Boolean(process.env.CI);

if (!hasBuild && inCi) {
  it('Referrer-Policy on the built server needs a build', () => {
    assert.fail('CI is set but there is no .next build: run npm run build before npm test');
  });
}

describe('Referrer-Policy on the built server', { skip: hasBuild ? false : 'no .next build; run npm run build first' }, () => {
  let server;
  let base;

  before(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const nextBin = join(WEB_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
    server = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: WEB_DIR,
      // A dead API address: these pages render without it, and nothing here should reach a real API.
      env: { ...process.env, API_URL: 'http://127.0.0.1:9/api', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitUntilUp(base, server);
  });

  after(() => server?.kill());

  for (const path of TOKEN_PAGES) {
    it(`GET ${path}?token=... sends Referrer-Policy: no-referrer`, async () => {
      const response = await fetch(`${base}${path}?token=abc123`, { redirect: 'manual' });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    });
  }

  for (const path of ['/', '/login', '/forgot-password']) {
    it(`GET ${path} sends no Referrer-Policy`, async () => {
      const response = await fetch(`${base}${path}`, { redirect: 'manual' });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('referrer-policy'), null);
    });
  }
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitUntilUp(base, child) {
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited (${child.exitCode}):\n${output}`);
    try {
      await fetch(`${base}/login`, { redirect: 'manual' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`next start did not answer within 30s:\n${output}`);
}
