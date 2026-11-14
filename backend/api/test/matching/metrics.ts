// Retrieval metrics for project.md §7 and §11. A ranking is the list a system actually returns
// (after its own filtering and cut-off), so a relevant report it never returns counts as a miss.

export function precisionAt(ranked: readonly string[], relevant: readonly string[], k: number): number {
  const wanted = new Set(relevant);
  return ranked.slice(0, k).filter((id) => wanted.has(id)).length / k;
}

export function recallAt(ranked: readonly string[], relevant: readonly string[], k: number): number {
  if (!relevant.length) throw new Error('recall is undefined for a query with no relevant reports');
  const wanted = new Set(relevant);
  return ranked.slice(0, k).filter((id) => wanted.has(id)).length / relevant.length;
}

/** 1 / rank of the first relevant report, or 0 if the system never returns one. */
export function reciprocalRank(ranked: readonly string[], relevant: readonly string[]): number {
  const wanted = new Set(relevant);
  const index = ranked.findIndex((id) => wanted.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

/** Nearest-rank percentile (p in 0–100) of a non-empty sample. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) throw new Error('percentile of an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export type Scores = { queries: number; precision5: number; recall5: number; mrr: number; ceilingP5: number };

export const mean = (values: readonly number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);

/** Mean P@5, R@5 and MRR over queries, plus the best P@5 any ranking could reach on them. */
export function score(results: readonly { ranked: readonly string[]; relevant: readonly string[] }[]): Scores {
  return {
    queries: results.length,
    precision5: mean(results.map((r) => precisionAt(r.ranked, r.relevant, 5))),
    recall5: mean(results.map((r) => recallAt(r.ranked, r.relevant, 5))),
    mrr: mean(results.map((r) => reciprocalRank(r.ranked, r.relevant))),
    ceilingP5: mean(results.map((r) => Math.min(r.relevant.length, 5) / 5)),
  };
}
