// Shapes used by the lost-and-found matching evaluation (project.md §7, §11).
// Reports carry the planned attributes (color, brand, itemDateTo) even though the API does not
// store them yet, so the dataset can stay frozen when the new scorer arrives.

export type EvalReport = {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  /** YYYY-MM-DD. The start of the time window. */
  itemDate: string;
  /** YYYY-MM-DD, or null for a single day. */
  itemDateTo: string | null;
  /** One of COLORS, or null when the reporter did not give one. */
  color: string | null;
  brand: string | null;
  /** ISO timestamp. Used for recency ordering and ties. */
  createdAt: string;
};

export type EvalQuery = {
  id: string;
  split: 'tuning' | 'test';
  /** A LOST report. Its candidates are the dataset's FOUND pool. */
  report: EvalReport;
  /** Ids of the pool reports that describe the same physical item. */
  relevant: string[];
  /** The noise and difficulty features present, for per-tag breakdowns. */
  tags: string[];
};

export type EvalDataset = {
  name: string;
  description: string;
  /** The generator seed, or null for a hand-written set. */
  seed: number | null;
  labelStatus: string;
  pool: EvalReport[];
  queries: EvalQuery[];
};

export type MatchSystem = {
  name: string;
  description: string;
  /**
   * The candidate selection the database does before the service scores anything (for example
   * ORDER BY createdAt DESC LIMIT 100). Applied before rank() and left out of latency timing.
   * Omitted means every pool report is a candidate.
   */
  select?(pool: readonly EvalReport[]): readonly EvalReport[];
  /** Candidate ids in the order the system would return them, after any filtering. */
  rank(query: EvalReport, candidates: readonly EvalReport[]): string[];
};

/** The full ranking of one query: the database-side selection, then the in-process ranking. */
export function rankAll(system: MatchSystem, query: EvalReport, pool: readonly EvalReport[]): string[] {
  return system.rank(query, system.select ? system.select(pool) : pool);
}
