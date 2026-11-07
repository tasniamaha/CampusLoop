import { describe, expect, it } from 'vitest';
import { assertUtcDatabaseClock } from './assert-utc-clock.js';

const db = (skewMin: unknown) => ({ query: async () => [{ skewMin }] }) as never;

describe('assertUtcDatabaseClock', () => {
  it('passes on a UTC server (drivers may return the number as a string)', async () => {
    await expect(assertUtcDatabaseClock(db(0))).resolves.toBeUndefined();
    await expect(assertUtcDatabaseClock(db('0'))).resolves.toBeUndefined();
  });

  it.each([360, -300, 30])('refuses to start when the clock is %i min off, and says how to fix it', async (skew) => {
    await expect(assertUtcDatabaseClock(db(skew))).rejects.toThrow(new RegExp(`${skew} min off UTC.*default-time-zone`));
  });

  it('refuses when the clock cannot be read', async () => {
    await expect(assertUtcDatabaseClock(db(null))).rejects.toThrow(/Could not read/);
    await expect(assertUtcDatabaseClock({ query: async () => [] } as never)).rejects.toThrow(/Could not read/);
  });
});
