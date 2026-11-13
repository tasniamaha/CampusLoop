import { describe, expect, it } from 'vitest';
import { EXCERPT_LENGTH, excerpt } from './reports.service.js';

describe('excerpt', () => {
  it('returns null for a missing or blank comment', () => {
    expect(excerpt(null)).toBeNull();
    expect(excerpt('   \n ')).toBeNull();
  });

  it('collapses whitespace and keeps short comments whole', () => {
    expect(excerpt('  Great \n\n lender  ')).toBe('Great lender');
  });

  it('cuts long comments at the limit and marks the cut', () => {
    const result = excerpt('a'.repeat(EXCERPT_LENGTH + 30));
    expect(result).toBe(`${'a'.repeat(EXCERPT_LENGTH)}…`);
  });

  it('never splits a character outside the basic plane', () => {
    const result = excerpt('😀'.repeat(EXCERPT_LENGTH + 1))!;
    expect(Array.from(result)).toHaveLength(EXCERPT_LENGTH + 1);
    expect(result.endsWith('😀…')).toBe(true);
  });
});
