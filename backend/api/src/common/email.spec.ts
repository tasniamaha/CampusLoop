import { describe, expect, it } from 'vitest';
import { canonicalEmail } from './email.js';

describe('canonicalEmail', () => {
  it('collapses gmail dots, +tags and googlemail', () => {
    expect(canonicalEmail('A.B.C+shop@Gmail.com')).toBe('abc@gmail.com');
    expect(canonicalEmail('abc@googlemail.com')).toBe('abc@gmail.com');
  });
  it('leaves other providers alone', () => {
    expect(canonicalEmail('First.Last+x@Example.com')).toBe('first.last+x@example.com');
  });
});