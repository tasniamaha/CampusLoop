import { describe, expect, it } from 'vitest';
import { slugify } from './admin-categories.service.js';

describe('slugify', () => {
  it('lowercases and joins words with single dashes', () => {
    expect(slugify('Lab Kits & Tools')).toBe('lab-kits-tools');
    expect(slugify('  Graphing   Calculators ')).toBe('graphing-calculators');
  });

  it('folds accents and drops leading/trailing separators', () => {
    expect(slugify('Électronique (Arduino)')).toBe('electronique-arduino');
    expect(slugify('--3D printers--')).toBe('3d-printers');
  });

  it('returns an empty slug for names with no letters or digits', () => {
    expect(slugify('!!! ??')).toBe('');
  });

  it('never exceeds 60 characters or ends with a dash after cutting', () => {
    const slug = slugify(`${'a'.repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});
