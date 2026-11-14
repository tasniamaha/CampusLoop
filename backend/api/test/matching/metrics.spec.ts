import { describe, expect, it } from 'vitest';
import { percentile, precisionAt, recallAt, reciprocalRank, score } from './metrics.js';

describe('matching metrics', () => {
  const ranked = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('computes precision and recall at 5 from the returned ranking', () => {
    expect(precisionAt(ranked, ['b', 'e', 'z'], 5)).toBeCloseTo(0.4);
    expect(recallAt(ranked, ['b', 'e', 'z'], 5)).toBeCloseTo(2 / 3);
    expect(precisionAt(ranked, ['f'], 5)).toBe(0);
    expect(recallAt(['a'], ['a'], 5)).toBe(1);
  });

  it('counts a relevant report the system never returns as a miss', () => {
    expect(reciprocalRank(ranked, ['z'])).toBe(0);
    expect(reciprocalRank([], ['a'])).toBe(0);
  });

  it('uses the first relevant report for the reciprocal rank', () => {
    expect(reciprocalRank(ranked, ['c', 'a'])).toBe(1);
    expect(reciprocalRank(ranked, ['d', 'f'])).toBe(0.25);
  });

  it('refuses recall for a query with no relevant reports', () => {
    expect(() => recallAt(ranked, [], 5)).toThrow();
  });

  it('averages over queries and reports the P@5 ceiling', () => {
    const s = score([
      { ranked: ['a', 'b'], relevant: ['a'] },
      { ranked: ['x', 'y', 'b'], relevant: ['b', 'c'] },
    ]);
    expect(s.queries).toBe(2);
    expect(s.precision5).toBeCloseTo((0.2 + 0.2) / 2);
    expect(s.recall5).toBeCloseTo((1 + 0.5) / 2);
    expect(s.mrr).toBeCloseTo((1 + 1 / 3) / 2);
    expect(s.ceilingP5).toBeCloseTo((0.2 + 0.4) / 2);
  });

  it('takes nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
  });
});
