// Synthetic, labelled lost-and-found set for project.md §7 evaluation.
//
// Each case is one physical item. It produces a LOST report (the query), one or two FOUND reports
// of the same item (the relevant answers), and often hard negatives: found reports that look
// close but describe a different item. Distractors fill the found pool to POOL_SIZE.
//
// Labels are true by construction: a found report is relevant exactly when it was rendered from
// the same case. The output is frozen in data/synthetic.json; dataset.spec.ts fails if this
// generator drifts from the committed file. Regenerate on purpose with npm run eval:matching:generate.

import {
  COLORS, COLOR_NEIGHBOURS, COLOR_WORDS, KINDS, PLACES, TIME_PHRASES,
  type Brand, type Color, type Kind, type Place,
} from './catalog.js';
import { createRng, type Rng } from './rng.js';
import type { EvalDataset, EvalQuery, EvalReport } from './types.js';

export const SYNTHETIC_SEED = 20261114;
export const QUERY_COUNT = 80;
export const POOL_SIZE = 300;

const FIRST_DAY = '2026-08-20';
const LAST_DAY = '2026-11-05';

type Item = { kind: Kind; color: Color; brand: Brand | null; place: Place; date: string; detail: string };
type Rendered = { report: Omit<EvalReport, 'id'>; noun: string; typo: boolean };

// ---------------- helpers ----------------

export function addDays(day: string, days: number): string {
  const time = Date.parse(`${day}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function timestamp(rng: Rng, day: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day}T${pad(rng.int(7, 21))}:${pad(rng.int(0, 59))}:${pad(rng.int(0, 59))}.000Z`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Joins sentence fragments, dropping empty ones and tidying spaces before punctuation. */
function sentence(...parts: (string | false | null | undefined)[]): string {
  const text = parts.filter((part): part is string => Boolean(part)).join(' ');
  return capitalise(text.replace(/\s+/g, ' ').replace(/\s+([.,?!)])/g, '$1').replace(/\(\s+/g, '(').trim());
}

/** One realistic typing slip in a word: swapped, dropped or doubled letter. */
function typoWord(rng: Rng, word: string): string {
  const i = rng.int(1, word.length - 2);
  switch (rng.int(0, 2)) {
    case 0: return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
    case 1: return word.slice(0, i) + word.slice(i + 1);
    default: return word.slice(0, i) + word[i] + word.slice(i);
  }
}

function addTypos(rng: Rng, text: string, count: number): string {
  const words = text.split(' ');
  const candidates = words.map((word, i) => (/^[A-Za-z]{5,}$/.test(word) ? i : -1)).filter((i) => i >= 0);
  for (const index of rng.shuffle(candidates).slice(0, count)) {
    const changed = typoWord(rng, words[index]);
    if (changed !== words[index]) words[index] = changed;
  }
  return words.join(' ');
}

function brandField(rng: Rng, brand: Brand): { value: string; alias: boolean } {
  const roll = rng.next();
  if (roll < 0.25 && brand.aliases.length) return { value: rng.pick(brand.aliases), alias: true };
  if (roll < 0.4) return { value: rng.chance(0.5) ? brand.name.toLowerCase() : brand.name.toUpperCase(), alias: false };
  return { value: brand.name, alias: false };
}

function categoryField(rng: Rng, kind: Kind): string {
  const category = rng.weighted(kind.categories);
  return rng.chance(0.2) ? category.toLowerCase() : category;
}

function randomItem(rng: Rng, kind = rng.pick(KINDS)): Item {
  return {
    kind,
    color: rng.pick(kind.colors),
    brand: kind.brands.length && rng.chance(0.85) ? rng.pick(kind.brands) : null,
    place: rng.pick(PLACES),
    date: addDays(FIRST_DAY, rng.int(0, daysBetween(FIRST_DAY, LAST_DAY))),
    detail: rng.pick(kind.details),
  };
}

const placeByKey = (key: string) => PLACES.find((place) => place.key === key)!;
const kindByKey = (key: string) => KINDS.find((kind) => kind.key === key)!;

// ---------------- rendering ----------------

type LostWindow = { from: string; to: string | null; beforeWindow: boolean };

function lostWindow(rng: Rng, date: string): LostWindow {
  // The owner misremembers and starts the window after the real date, so the finder's date
  // falls before it. Rare, but it happens.
  if (rng.chance(0.08)) {
    const from = addDays(date, rng.int(1, 2));
    const to = rng.chance(0.5) ? addDays(from, rng.int(1, 2)) : null;
    return { from, to, beforeWindow: true };
  }
  if (rng.chance(0.55)) return { from: date, to: null, beforeWindow: false };
  const from = addDays(date, -rng.int(0, 3));
  const to = addDays(date, rng.int(0, 2));
  return { from, to: to === from ? null : to, beforeWindow: false };
}

function renderLost(rng: Rng, item: Item, window: LostWindow): Rendered {
  const { kind } = item;
  const noun = rng.pick(kind.nouns);
  const color: Color | null = rng.chance(0.22) ? null : item.color;
  const colorWord = color || rng.chance(0.4) ? rng.pick(COLOR_WORDS[item.color]) : '';
  const brand = item.brand && rng.chance(0.75) ? brandField(rng, item.brand).value : null;
  const brandText = brand ? (rng.chance(0.5) ? brand : '') : item.brand && rng.chance(0.3) ? item.brand.name : '';
  const detail = rng.chance(0.65) ? item.detail : '';
  const vague = rng.chance(0.1);
  const location = vague
    ? `somewhere between ${item.place.short} and ${rng.pick(PLACES.filter((p) => p.key !== item.place.key)).short}`
    : rng.pick(item.place.variants);
  const where = rng.chance(0.6) ? (vague ? location : `at ${rng.pick(item.place.variants)}`) : '';
  const when = rng.chance(0.6) ? rng.pick(TIME_PHRASES) : '';

  const title = rng.pick([
    () => sentence('Lost', colorWord, noun),
    () => sentence(brandText, noun, 'lost'),
    () => sentence('Missing', noun),
    () => sentence('Lost', noun, 'at', item.place.short),
    () => sentence('Has anyone seen my', colorWord, noun, '?'),
  ])();
  const description = rng.pick([
    () => sentence('I lost my', colorWord, brandText, noun, detail, '.', where && `I last had it ${where}`, when, '.'),
    () => sentence('Lost a', noun, brandText || colorWord ? `(${[brandText, colorWord].filter(Boolean).join(', ')})` : '', detail, '.', where && `Probably left it ${where}.`),
    () => sentence('My', noun, 'went missing', when, '.', colorWord && `It is ${colorWord}${detail ? `, ${detail}` : ''}.`, 'Please message me if you find it.'),
    () => sentence('Left my', brandText, noun, where || 'somewhere on campus', '.', detail && `${capitalise(detail)}.`, colorWord && `Colour: ${colorWord}.`),
  ])();

  const typo = rng.chance(0.2);
  const typoCount = rng.int(1, 2);
  const report: Omit<EvalReport, 'id'> = {
    title: typo && rng.chance(0.3) ? addTypos(rng, title, 1) : title,
    description: typo ? addTypos(rng, description, typoCount) : description,
    category: categoryField(rng, kind),
    location,
    itemDate: window.from,
    itemDateTo: window.to,
    color,
    brand,
    createdAt: timestamp(rng, addDays(window.to ?? window.from, rng.int(0, 2))),
  };
  return { report, noun, typo };
}

type FoundOptions = { allowConflict?: boolean };

function renderFound(rng: Rng, item: Item, foundDate: string, options: FoundOptions = {}): Rendered & { conflict: boolean; alias: boolean } {
  const { kind } = item;
  const noun = rng.pick(kind.nouns);
  const conflict = (options.allowConflict ?? true) && rng.chance(0.18);
  const seen: Color = conflict ? rng.pick(COLOR_NEIGHBOURS[item.color]) : item.color;
  const color: Color | null = rng.chance(0.12) ? null : seen;
  const colorWord = color || rng.chance(0.5) ? rng.pick(COLOR_WORDS[seen]) : '';
  const brandPick = item.brand && rng.chance(0.55) ? brandField(rng, item.brand) : null;
  const brand = brandPick?.value ?? null;
  const brandText = brand ? (rng.chance(0.5) ? brand : '') : item.brand && rng.chance(0.15) ? item.brand.name : '';
  const detail = rng.chance(0.55) ? item.detail : '';
  const variant = rng.pick(item.place.variants);
  const where = `at ${rng.chance(0.5) ? variant : rng.pick(item.place.variants)}`;
  const when = rng.chance(0.4) ? rng.pick(TIME_PHRASES) : '';

  const title = rng.pick([
    () => sentence('Found', colorWord, noun),
    () => sentence(noun, 'found at', item.place.short),
    () => sentence('Found:', brandText, noun),
    () => sentence(colorWord, noun, 'left behind'),
    () => sentence('Found a', noun),
  ])();
  const description = rng.pick([
    () => sentence('Found a', colorWord, noun, detail, where, '.', 'Handed it to the security desk.'),
    () => sentence('Someone left this', noun, where, '.', [colorWord, brandText].filter(Boolean).join(', '), colorWord || brandText ? '.' : '', 'Message me with details to claim.'),
    () => sentence('Picked up a', noun, where, when, '.', detail && `${capitalise(detail)}.`),
    () => sentence(colorWord, noun, brandText && `, looks like ${brandText}`, '.', 'Found', where, '.'),
  ])();

  const typo = rng.chance(0.2);
  const report: Omit<EvalReport, 'id'> = {
    title: typo && rng.chance(0.3) ? addTypos(rng, title, 1) : title,
    description: typo ? addTypos(rng, description, rng.int(1, 2)) : description,
    category: categoryField(rng, kind),
    location: variant,
    itemDate: foundDate,
    itemDateTo: null,
    color,
    brand,
    createdAt: timestamp(rng, addDays(foundDate, rng.int(0, 1))),
  };
  return { report, noun, typo, conflict, alias: brandPick?.alias ?? false };
}

// ---------------- hard negatives ----------------

/** Found reports that resemble the case but describe a different item. */
function hardNegatives(rng: Rng, item: Item, window: LostWindow): Item[] {
  const near = () => addDays(item.date, rng.int(0, 2));
  const otherColor = (kind: Kind) => {
    const avoid = new Set<Color>([item.color, ...COLOR_NEIGHBOURS[item.color]]);
    const options = kind.colors.filter((c) => !avoid.has(c));
    return options.length ? rng.pick(options) : rng.pick(COLORS.filter((c) => !avoid.has(c)));
  };
  const builders: (() => Item | null)[] = [
    // Same kind and place, clearly different colour.
    () => ({ ...randomItem(rng, item.kind), color: otherColor(item.kind), place: item.place, date: near() }),
    // Same kind and colour, a different brand, elsewhere.
    () => {
      const brands = item.kind.brands.filter((brand) => brand.name !== item.brand?.name);
      if (!item.brand || !brands.length) return null;
      return { ...randomItem(rng, item.kind), color: item.color, brand: rng.pick(brands), date: near() };
    },
    // A look-alike kind in the same place and colour.
    () => {
      if (!item.kind.confusable.length) return null;
      const kind = kindByKey(rng.pick(item.kind.confusable));
      return { ...randomItem(rng, kind), color: kind.colors.includes(item.color) ? item.color : rng.pick(kind.colors), place: item.place, date: near() };
    },
    // The same description, but found weeks before the owner lost theirs.
    () => ({ ...item, detail: rng.pick(item.kind.details), date: addDays(window.from, -rng.int(20, 45)) }),
    // Something else entirely, same place and day.
    () => ({ ...randomItem(rng, rng.pick(KINDS.filter((k) => k.key !== item.kind.key))), place: item.place, date: item.date }),
    // Same kind at a similarly named place, different colour.
    () => {
      if (!item.place.confusable.length) return null;
      return { ...randomItem(rng, item.kind), color: otherColor(item.kind), place: placeByKey(rng.pick(item.place.confusable)), date: near() };
    },
  ];
  const count = rng.chance(0.7) ? rng.int(1, 3) : 0;
  const items: Item[] = [];
  for (const build of rng.shuffle(builders)) {
    if (items.length >= count) break;
    const negative = build();
    if (negative) items.push(negative);
  }
  return items;
}

// ---------------- dataset ----------------

const normal = (value: string | null) => (value ?? '').trim().toLowerCase();

function foundDelay(rng: Rng): number {
  return rng.weighted([[0, 45], [1, 25], [2, 12], [4, 10], [8, 8]] as const);
}

export function generateSynthetic(seed = SYNTHETIC_SEED): EvalDataset {
  const rng = createRng(seed);
  type PoolEntry = { report: Omit<EvalReport, 'id'>; caseIndex: number | null };
  const pool: PoolEntry[] = [];
  const cases: { lost: Omit<EvalReport, 'id'>; tags: Set<string> }[] = [];

  for (let caseIndex = 0; caseIndex < QUERY_COUNT; caseIndex++) {
    const item = randomItem(rng);
    const window = lostWindow(rng, item.date);
    const lost = renderLost(rng, item, window);
    const tags = new Set<string>();
    if (lost.typo) tags.add('typo');
    if (window.to) tags.add('time-window');
    if (lost.report.location.startsWith('somewhere between')) tags.add('vague-location');
    if (!lost.report.color) tags.add('colour-missing');
    if (item.brand && !lost.report.brand) tags.add('brand-missing');

    const finders = rng.chance(0.15) ? 2 : 1;
    if (finders === 2) tags.add('multi-relevant');
    // When the owner's window starts too late, the finder reports it on the real day.
    let foundDate = addDays(item.date, window.beforeWindow ? 0 : foundDelay(rng));
    for (let f = 0; f < finders; f++) {
      if (f > 0) foundDate = addDays(foundDate, rng.int(0, 3));
      const found = renderFound(rng, item, foundDate);
      const r = found.report;
      if (found.typo) tags.add('typo');
      if (found.noun !== lost.noun) tags.add('noun-synonym');
      if (!r.color) tags.add('colour-missing');
      if (found.conflict && r.color && lost.report.color) tags.add('colour-conflict');
      if (item.brand && !r.brand) tags.add('brand-missing');
      if (r.brand && lost.report.brand && normal(r.brand) !== normal(lost.report.brand)) tags.add('brand-alias');
      if (normal(r.category) !== normal(lost.report.category)) tags.add('category-differs');
      if (normal(r.location) !== normal(lost.report.location)) tags.add('location-wording-differs');
      if (r.itemDate < window.from) tags.add('found-before-window');
      if (daysBetween(window.to ?? window.from, r.itemDate) > 3) tags.add('found-late');
      pool.push({ report: r, caseIndex });
    }

    const negatives = hardNegatives(rng, item, window);
    if (negatives.length) tags.add('hard-negatives');
    for (const negative of negatives) {
      pool.push({ report: renderFound(rng, negative, negative.date, { allowConflict: false }).report, caseIndex: null });
    }
    cases.push({ lost: lost.report, tags });
  }

  if (pool.length > POOL_SIZE) throw new Error(`Pool overflow: ${pool.length} > ${POOL_SIZE}`);
  while (pool.length < POOL_SIZE) {
    const item = randomItem(rng);
    pool.push({ report: renderFound(rng, item, item.date).report, caseIndex: null });
  }

  // Shuffle before numbering so ids carry no hint of which case a report came from.
  const numbered = rng.shuffle(pool).map((entry, i) => ({ ...entry, id: `f-${String(i + 1).padStart(3, '0')}` }));
  const order = rng.shuffle(cases.map((_, i) => i));
  const tuning = new Set(order.slice(0, QUERY_COUNT / 2));

  const queries: EvalQuery[] = cases.map((c, i) => ({
    id: `q-${String(i + 1).padStart(3, '0')}`,
    split: tuning.has(i) ? 'tuning' : 'test',
    report: { id: `l-${String(i + 1).padStart(3, '0')}`, ...c.lost },
    relevant: numbered.filter((entry) => entry.caseIndex === i).map((entry) => entry.id),
    tags: [...c.tags].sort(),
  }));

  return {
    name: 'synthetic',
    description:
      `Template-generated campus lost-and-found reports (seed ${seed}). ${QUERY_COUNT} LOST queries ` +
      `against ${POOL_SIZE} FOUND reports: relevant matches, hard negatives and distractors.`,
    seed,
    labelStatus: 'Labels are true by construction: relevant means rendered from the same generated item.',
    pool: numbered.map(({ id, report }) => ({ id, ...report })),
    queries,
  };
}

/** Extra unlabelled FOUND reports to grow a pool for latency runs (300, 1000, 5000). */
export function generateDistractors(count: number, seed: number): EvalReport[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) => {
    const item = randomItem(rng);
    return { id: `x-${String(i + 1).padStart(5, '0')}`, ...renderFound(rng, item, item.date).report };
  });
}
