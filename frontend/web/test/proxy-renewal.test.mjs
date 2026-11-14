// proxy.ts renewal de-duplication. Runs proxy() itself with a fake API (globalThis.fetch).
// npm test (node --test with native type stripping; see ts-resolve.mjs).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

process.env.API_URL = 'http://api.test/api';
const { NextRequest } = await import('next/server');
const { proxy } = await import('../proxy.ts');
const { RENEWAL_SHARE_MS, inFlightRenewals, renewalLookups } = await import('../lib/session.ts');

const realFetch = globalThis.fetch;
let refreshCalls;

/** A fake /auth/refresh: `answer(call, n)` decides the outcome of the n-th call. */
function fakeApi(answer) {
  refreshCalls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://api.test/api/auth/refresh');
    const sent = JSON.parse(init.body).refreshToken;
    const call = { token: sent };
    refreshCalls.push(call);
    return answer(call, refreshCalls.length);
  };
}

/** Holds every fake API answer until release(), so concurrent requests really overlap. */
function gate() {
  let release;
  const opened = new Promise((resolve) => (release = resolve));
  return { opened, release };
}
/**
 * Resolves once `count` more callers have reached the in-flight lookup. Hashing the token (Web
 * Crypto) is asynchronous, so the fake API must not answer before every request got that far.
 * Polls on real timers (mock.timers only fakes Date here) and fails after `timeoutMs`.
 */
function lookupsReached(count, timeoutMs = 2_000) {
  const target = renewalLookups() + count;
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (renewalLookups() >= target) return resolve();
      if (performance.now() > deadline) return reject(new Error(`expected ${target} renewal lookups, saw ${renewalLookups()}`));
      setTimeout(check, 1);
    };
    check();
  });
}

const session = (n) =>
  Response.json({
    accessToken: `access-${n}`,
    expiresIn: 900,
    refreshToken: `refresh-${n}`,
    refreshExpiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    user: { id: 'u1' },
  });

/** A page request whose access cookie has expired: only the refresh cookie is left. */
const expired = (refreshToken, path = '/dashboard') =>
  new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: `campusloop_refresh=${refreshToken}` } });

const setCookies = (response) => response.headers.getSetCookie().sort();
const cookieValue = (response, name) => setCookies(response).find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);

beforeEach(() => assert.equal(inFlightRenewals(), 0));
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

describe('proxy renewal', () => {
  it('several concurrent requests with an expired access cookie make one /auth/refresh call and all get the same cookies', async () => {
    const { opened, release } = gate();
    fakeApi(async (_call, n) => {
      await opened;
      return session(n);
    });

    // The page, two prefetches and the notification poll, all at once with one refresh cookie.
    const paths = ['/dashboard', '/resources', '/borrowings', '/api/backend/notifications/unread-count'];
    const reached = lookupsReached(paths.length);
    const pending = paths.map((path) => proxy(expired('old-token', path)));
    await reached;
    assert.equal(inFlightRenewals(), 1);
    release();
    const responses = await Promise.all(pending);

    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0].token, 'old-token');
    const first = setCookies(responses[0]);
    assert.equal(first.length, 2);
    for (const response of responses) assert.deepEqual(setCookies(response), first);
    assert.equal(cookieValue(responses[0], 'campusloop_token'), 'access-1');
    assert.equal(cookieValue(responses[0], 'campusloop_refresh'), 'refresh-1');
    assert.equal(inFlightRenewals(), 0);
  });

  it('keeps nothing once the call settles: the next request makes a new call', async () => {
    fakeApi((_call, n) => session(n));
    await proxy(expired('old-token'));
    await proxy(expired('old-token'));
    assert.equal(refreshCalls.length, 2);
  });

  it('a transient failure is shared by its waiters, sets no cookies, and is not cached', async () => {
    const { opened, release } = gate();
    fakeApi(async (_call, n) => {
      if (n === 1) {
        await opened;
        throw new Error('API down');
      }
      return session(n);
    });
    const reached = lookupsReached(3);
    const pending = [1, 2, 3].map(() => proxy(expired('old-token')));
    await reached;
    release();
    const failed = await Promise.all(pending);
    assert.equal(refreshCalls.length, 1);
    for (const response of failed) assert.deepEqual(setCookies(response), []);
    assert.equal(inFlightRenewals(), 0);

    const retried = await proxy(expired('old-token'));
    assert.equal(refreshCalls.length, 2);
    assert.equal(cookieValue(retried, 'campusloop_refresh'), 'refresh-2');
  });

  it('a rejected token clears the cookies for every waiter, and the next request asks again', async () => {
    const { opened, release } = gate();
    fakeApi(async () => {
      await opened;
      return Response.json({ message: 'Session expired. Please log in again.' }, { status: 401 });
    });
    const reached = lookupsReached(2);
    const pending = [1, 2].map(() => proxy(expired('old-token')));
    await reached;
    release();
    const responses = await Promise.all(pending);
    assert.equal(refreshCalls.length, 1);
    for (const response of responses) {
      assert.equal(cookieValue(response, 'campusloop_token'), '');
      assert.equal(cookieValue(response, 'campusloop_refresh'), '');
      assert.ok(setCookies(response).every((c) => /Max-Age=0/i.test(c)));
    }
    await proxy(expired('old-token'));
    assert.equal(refreshCalls.length, 2);
  });

  it('different refresh tokens are never shared', async () => {
    fakeApi((_call, n) => session(n));
    const [a, b] = await Promise.all([proxy(expired('token-a')), proxy(expired('token-b'))]);
    assert.deepEqual(refreshCalls.map((c) => c.token).sort(), ['token-a', 'token-b']);
    assert.notEqual(cookieValue(a, 'campusloop_refresh'), cookieValue(b, 'campusloop_refresh'));
  });

  it('stops sharing a call that never settles after the safety expiry', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const never = new Promise(() => {});
    fakeApi(async (_call, n) => (n === 1 ? never : session(n)));

    let reached = lookupsReached(1);
    void proxy(expired('old-token'));
    await reached;
    reached = lookupsReached(1);
    void proxy(expired('old-token')); // within the expiry: shares the stuck call
    await reached;
    assert.equal(refreshCalls.length, 1);

    mock.timers.tick(RENEWAL_SHARE_MS + 1);
    const fresh = await proxy(expired('old-token'));
    assert.equal(refreshCalls.length, 2);
    assert.equal(cookieValue(fresh, 'campusloop_refresh'), 'refresh-2');
    // The stuck entry was replaced and the fresh one removed when it settled.
    assert.equal(inFlightRenewals(), 0);
  });

  it('leaves requests that still have an access cookie alone', async () => {
    fakeApi(() => assert.fail('no refresh expected'));
    const request = new NextRequest('http://localhost:3000/dashboard', { headers: { cookie: 'campusloop_token=a; campusloop_refresh=r' } });
    const response = await proxy(request);
    assert.deepEqual(setCookies(response), []);
    assert.equal(refreshCalls.length, 0);
  });
});
