// npm run eval:matching. Scores every system on the frozen synthetic set and the hand-written set,
// measures in-process scorer latency at several pool sizes, and writes docs/matching-eval.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateDistractors, SYNTHETIC_SEED } from './generate-synthetic.js';
import { mean, percentile, recallAt, reciprocalRank, score, type Scores } from './metrics.js';
import { CURRENT_TAKE, SYSTEMS } from './systems.js';
import { rankAll, type EvalDataset, type EvalQuery, type EvalReport, type MatchSystem } from './types.js';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const load = (path: string) => JSON.parse(readFileSync(here(path), 'utf8')) as EvalDataset;

const POOL_SIZES = [300, 1000, 5000] as const;
const WARMUP_PASSES = 2;
const TIMED_PASSES = 5;
const MIN_TAG_QUERIES = 5;

type Ranked = { query: EvalQuery; ranked: string[] };

function run(system: MatchSystem, queries: readonly EvalQuery[], pool: readonly EvalReport[]): Ranked[] {
  return queries.map((query) => ({ query, ranked: rankAll(system, query.report, pool) }));
}

const toScores = (rows: Ranked[]): Scores => score(rows.map((r) => ({ ranked: r.ranked, relevant: r.query.relevant })));

function latency(system: MatchSystem, queries: readonly EvalQuery[], pool: readonly EvalReport[]) {
  // The database-side selection is done once, outside the timed region.
  const candidates = system.select ? system.select(pool) : pool;
  for (let pass = 0; pass < WARMUP_PASSES; pass++) for (const q of queries) system.rank(q.report, candidates);
  const samples: number[] = [];
  for (let pass = 0; pass < TIMED_PASSES; pass++) {
    for (const q of queries) {
      const start = performance.now();
      system.rank(q.report, candidates);
      samples.push(performance.now() - start);
    }
  }
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), samples: samples.length };
}

const f3 = (value: number) => value.toFixed(3);
const ms = (value: number) => value.toFixed(2);
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;

function scoreTable(results: Map<MatchSystem, Scores>): string[] {
  const ceiling = [...results.values()][0].ceilingP5;
  return [
    row(['System', 'P@5', 'R@5', 'MRR']),
    row(['---', '---:', '---:', '---:']),
    ...[...results].map(([system, s]) => row([system.name, f3(s.precision5), f3(s.recall5), f3(s.mrr)])),
    '',
    `Best possible P@5 on these queries: ${f3(ceiling)} (most queries have one relevant report, so a perfect ranking scores 0.2 on them).`,
  ];
}

it('writes docs/matching-eval.md', () => {
  const synthetic = load('./data/synthetic.json');
  const human = load('./data/human.json');
  const tuning = synthetic.queries.filter((q) => q.split === 'tuning');
  const test = synthetic.queries.filter((q) => q.split === 'test');

  const byTest = new Map<MatchSystem, Ranked[]>();
  const sets = { tuning: new Map<MatchSystem, Scores>(), test: new Map<MatchSystem, Scores>(), human: new Map<MatchSystem, Scores>() };
  for (const system of SYSTEMS) {
    const testRuns = run(system, test, synthetic.pool);
    byTest.set(system, testRuns);
    sets.test.set(system, toScores(testRuns));
    sets.tuning.set(system, toScores(run(system, tuning, synthetic.pool)));
    sets.human.set(system, toScores(run(system, human.queries, human.pool)));
  }

  // Per-tag breakdown on the synthetic test half.
  const tags = [...new Set(test.flatMap((q) => q.tags))].sort();
  const tagRows = tags.map((tag) => {
    const n = test.filter((q) => q.tags.includes(tag)).length;
    const cells = SYSTEMS.flatMap((system) => {
      if (n < MIN_TAG_QUERIES) return ['–', '–'];
      const rows = byTest.get(system)!.filter((r) => r.query.tags.includes(tag));
      return [f3(mean(rows.map((r) => recallAt(r.ranked, r.query.relevant, 5)))), f3(mean(rows.map((r) => reciprocalRank(r.ranked, r.query.relevant))))];
    });
    return row([tag, n, ...cells]);
  });

  // Latency: the synthetic pool, grown with unlabelled distractors.
  const extra = generateDistractors(Math.max(...POOL_SIZES) - synthetic.pool.length, SYNTHETIC_SEED + 1);
  const latencyRows = SYSTEMS.map((system) => {
    const cells = POOL_SIZES.flatMap((size) => {
      const pool = [...synthetic.pool, ...extra.slice(0, size - synthetic.pool.length)];
      const { p50, p95 } = latency(system, test, pool);
      return [ms(p50), ms(p95)];
    });
    return row([system.name, ...cells]);
  });

  const tagCounts = (dataset: EvalDataset) => {
    const counts = new Map<string, number>();
    for (const q of dataset.queries) for (const t of q.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `\`${t}\` ${n}`).join(', ');
  };
  const relevantCount = (dataset: EvalDataset) => dataset.queries.reduce((sum, q) => sum + q.relevant.length, 0);

  // How much of each half the current newest-100 cap can reach at all.
  const newest = new Set(
    [...synthetic.pool].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, CURRENT_TAKE).map((r) => r.id),
  );
  const reach = (queries: readonly EvalQuery[]) => {
    const relevant = queries.flatMap((q) => q.relevant);
    const reachable = relevant.filter((id) => newest.has(id)).length;
    const anyReachable = queries.filter((q) => q.relevant.some((id) => newest.has(id))).length;
    return (
      `The current matches() only considers the ${CURRENT_TAKE} newest pool reports: ${reachable} of these queries' ` +
      `${relevant.length} relevant reports are among them, and ${anyReachable} of ${queries.length} queries have at least one.`
    );
  };

  const lines = [
    '# Lost-and-found matching evaluation',
    '',
    '> Generated by `npm run eval:matching` from `backend/api/test/matching/`. Do not edit by hand.',
    '>',
    '> **The synthetic results are measured on synthetic, template-generated data.** They show how the systems compare on',
    '> the noise the generator models, not how they perform on real campus reports. The hand-written set is small and its',
    '> labels are still a draft (see below).',
    '',
    'project.md §7 and §11: Precision@5, Recall@5 and Mean Reciprocal Rank against a keyword-only baseline, plus latency.',
    'The §7 weighted scorer is not implemented yet. It will be added to this report as a third system when it lands, and',
    'no improvement is claimed until its numbers are here.',
    '',
    '## Results',
    '',
    `### Synthetic set, test half (${test.length} queries) — SYNTHETIC`,
    '',
    ...scoreTable(sets.test),
    '',
    reach(test),
    '',
    `### Synthetic set, tuning half (${tuning.length} queries) — SYNTHETIC`,
    '',
    'Reported for completeness. Any weight tuning uses this half only, so the test half above is the number to quote.',
    '',
    ...scoreTable(sets.tuning),
    '',
    reach(tuning),
    '',
    `### Hand-written set (${human.queries.length} queries, labels DRAFT)`,
    '',
    `Label status: ${human.labelStatus}`,
    '',
    ...scoreTable(sets.human),
    '',
    `The pool has only ${human.pool.length} reports, so R@5 saturates quickly here; MRR is the more telling column.`,
    `The newest-${CURRENT_TAKE} cap does not bite on a pool this small.`,
    '',
    '### Synthetic test half by tag — SYNTHETIC',
    '',
    `R@5 and MRR on the test queries that carry each tag. Tags on fewer than ${MIN_TAG_QUERIES} test queries show –.`,
    '',
    row(['Tag', 'Queries', ...SYSTEMS.flatMap((s) => [`${s.name} R@5`, `${s.name} MRR`])]),
    row(['---', '---:', ...SYSTEMS.flatMap(() => ['---:', '---:'])]),
    ...tagRows,
    '',
    '### Scorer latency (ms per query)',
    '',
    `In-process scoring and ranking time for one query over the candidates the system scores, on the ${test.length} synthetic`,
    `test queries (${WARMUP_PASSES} warm-up passes, then ${TIMED_PASSES} timed passes: ${test.length * TIMED_PASSES} samples per cell).`,
    'Database and HTTP time are not included. Pools above 300 add unlabelled synthetic distractors.',
    '',
    row(['System', ...POOL_SIZES.flatMap((n) => [`${n} p50`, `${n} p95`])]),
    row(['---', ...POOL_SIZES.flatMap(() => ['---:', '---:'])]),
    ...latencyRows,
    '',
    `Measured on Node ${process.version}, ${process.platform}, ${cpus()[0]?.model.trim() ?? 'unknown CPU'}, under Vitest in a single worker.`,
    `The current system scores only the ${CURRENT_TAKE} newest candidates, so its time stays flat as the pool grows; the`,
    `database's ORDER BY createdAt DESC LIMIT ${CURRENT_TAKE} that picks them is not timed.`,
    '',
    '## Datasets',
    '',
    `**Synthetic** (\`test/matching/data/synthetic.json\`, frozen). ${synthetic.description}`,
    `${relevantCount(synthetic)} relevant reports in all. Split ${tuning.length}/${test.length} into tuning and test with the same seed.`,
    '',
    '- Each generated item yields one LOST report (the query) and one or two FOUND reports of the same item (relevant).',
    '- Noise, applied independently to each side: noun synonyms and paraphrased templates, typos, colour words instead',
    '  of the colour field value, missing colour or brand, brand aliases and case variants, a finder recording a',
    '  neighbouring colour, free-text category variants, different wordings of the same place, vague locations, time',
    '  windows, finders reporting days later, and owners whose window starts after the real date.',
    '- Hard negatives: the same kind in another colour, another brand, a look-alike kind (glasses and sunglasses,',
    '  earbuds and headphones), the same item found weeks before the loss, another item at the same place and day, and',
    '  similarly named places (Lecture Hall A and B).',
    '- Labels are true by construction. `dataset.spec.ts` fails if the generator no longer reproduces the committed file.',
    '',
    `Query tags: ${tagCounts(synthetic)}.`,
    '',
    `**Hand-written** (\`test/matching/data/human.json\`). ${human.description} ${relevantCount(human)} relevant reports.`,
    'Written separately from the generator in free-form wording, including abbreviations (LH-A), aliases (HP and',
    'Hewlett-Packard, Redmi and Xiaomi), colour clashes (a gold frame in a brown case), typos and a found date before the',
    "owner's window.",
    '',
    `Query tags: ${tagCounts(human)}.`,
    '',
    '## Method',
    '',
    '- **Relevance** is binary: a FOUND report is relevant to a LOST query when it describes the same physical item.',
    '- **Ranking** is the list a system actually returns, after its own filtering. A relevant report it drops or never',
    '  considers is a miss: it lowers R@5 and, if it is the only one, sets the reciprocal rank to 0.',
    '- **P@5** = relevant reports in the top 5 / 5. **R@5** = relevant reports in the top 5 / all relevant reports.',
    '  **MRR** = mean of 1 / rank of the first relevant report. Means are over queries.',
    '- Campus and type filters (project.md §7) are applied before ranking, so every pool here is one campus of open',
    '  FOUND reports. All pool reports are treated as open at the same time.',
    '',
    '### Systems',
    '',
    ...SYSTEMS.map((s) => `- **${s.name}**: ${s.description}`),
    '',
    '## Limitations',
    '',
    '- The synthetic set and the systems are written by the same author, so the set may favour signals the author',
    '  thought of. It was frozen before the new scorer was written, and the hand-written set is reported separately.',
    '- The hand-written set has 20 queries: one query moves its MRR by up to 0.05. Its labels are not yet reviewed.',
    '- One campus, all reports open at once, and no churn: real pools change while a report is open.',
    '- Latency covers in-process scoring only, on one machine.',
    '',
    '## Reproduce',
    '',
    '```bash',
    'cd backend/api',
    'npm run eval:matching            # rewrites this file',
    'npm run eval:matching:generate   # rewrites the frozen synthetic set (only on purpose)',
    '```',
    '',
  ];

  writeFileSync(here('../../docs/matching-eval.md'), lines.join('\n'));
  for (const [name, results] of Object.entries(sets)) {
    for (const [system, s] of results) console.log(`${name.padEnd(6)} ${system.name.padEnd(20)} P@5 ${f3(s.precision5)}  R@5 ${f3(s.recall5)}  MRR ${f3(s.mrr)}`);
  }
});
