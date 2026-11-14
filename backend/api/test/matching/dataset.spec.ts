import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLORS } from './catalog.js';
import { addDays, generateSynthetic, POOL_SIZE, QUERY_COUNT } from './generate-synthetic.js';
import type { EvalDataset, EvalReport } from './types.js';

const load = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./data/${name}.json`, import.meta.url)), 'utf8')) as EvalDataset;

const synthetic = load('synthetic');
const human = load('human');

function checkReport(report: EvalReport) {
  expect(report.title.trim()).not.toBe('');
  expect(report.description.trim()).not.toBe('');
  expect(report.category.trim()).not.toBe('');
  expect(report.location.trim()).not.toBe('');
  expect(report.itemDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  if (report.color !== null) expect(COLORS).toContain(report.color);
  if (report.itemDateTo !== null) {
    // The planned DTO rule: the end is after the start, and the window spans at most 30 days.
    expect(report.itemDateTo > report.itemDate).toBe(true);
    expect(report.itemDateTo <= addDays(report.itemDate, 30)).toBe(true);
  }
  expect(Number.isNaN(Date.parse(report.createdAt))).toBe(false);
}

describe.each([
  ['synthetic', synthetic],
  ['human', human],
])('%s matching dataset', (_name, dataset) => {
  it('has unique ids and labels that point into the pool', () => {
    const ids = [...dataset.pool.map((r) => r.id), ...dataset.queries.flatMap((q) => [q.id, q.report.id])];
    expect(new Set(ids).size).toBe(ids.length);
    const pool = new Set(dataset.pool.map((r) => r.id));
    for (const query of dataset.queries) {
      expect(query.relevant.length).toBeGreaterThan(0);
      for (const id of query.relevant) expect(pool.has(id)).toBe(true);
    }
  });

  it('uses only well-formed reports', () => {
    for (const report of [...dataset.pool, ...dataset.queries.map((q) => q.report)]) checkReport(report);
  });

  it('states how its labels were made', () => {
    expect(dataset.labelStatus.trim()).not.toBe('');
  });
});

describe('synthetic matching dataset', () => {
  it('is frozen: the generator reproduces the committed file exactly', () => {
    expect(generateSynthetic(synthetic.seed!)).toEqual(synthetic);
  });

  it('has the documented size and an even tuning/test split', () => {
    expect(synthetic.queries).toHaveLength(QUERY_COUNT);
    expect(synthetic.pool).toHaveLength(POOL_SIZE);
    expect(synthetic.queries.filter((q) => q.split === 'tuning')).toHaveLength(QUERY_COUNT / 2);
    expect(synthetic.queries.filter((q) => q.split === 'test')).toHaveLength(QUERY_COUNT / 2);
  });

  it('covers every kind of noise and difficulty it claims, in both halves', () => {
    const required = [
      'noun-synonym', 'typo', 'colour-missing', 'colour-conflict', 'brand-missing', 'category-differs',
      'location-wording-differs', 'vague-location', 'time-window', 'found-before-window', 'found-late',
      'multi-relevant', 'hard-negatives',
    ];
    for (const split of ['tuning', 'test'] as const) {
      const tags = new Set(synthetic.queries.filter((q) => q.split === split).flatMap((q) => q.tags));
      for (const tag of required) expect(tags, `${split} half lacks ${tag}`).toContain(tag);
    }
  });
});

describe('hand-written matching dataset', () => {
  it('has about 20 held-out queries', () => {
    expect(human.queries.length).toBeGreaterThanOrEqual(20);
    expect(human.queries.every((q) => q.split === 'test')).toBe(true);
  });
});
