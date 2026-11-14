// Ranking systems compared by the matching evaluation. Each takes a LOST query and the FOUND pool
// (campus and type filters already applied) and returns candidate ids in the order the system
// would return them.

import type { EvalReport, MatchSystem } from './types.js';

const words = (value: string) =>
  new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3));

const newestFirst = (a: EvalReport, b: EvalReport) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/**
 * project.md §7 keyword-only baseline: the number of distinct shared words (3+ letters) in title
 * and description. Nothing else. Zero-overlap candidates are dropped; ties go to the newest report.
 */
export const keywordBaseline: MatchSystem = {
  name: 'keyword baseline',
  description: 'Shared distinct words (3+ letters) in title and description; ties newest first.',
  rank(query, candidates) {
    const queryWords = words(`${query.title} ${query.description}`);
    return candidates
      .filter((candidate) => candidate.id !== query.id)
      .map((candidate) => {
        const candidateWords = words(`${candidate.title} ${candidate.description}`);
        return { candidate, shared: [...queryWords].filter((word) => candidateWords.has(word)).length };
      })
      .filter((entry) => entry.shared > 0)
      .sort((a, b) => b.shared - a.shared || newestFirst(a.candidate, b.candidate))
      .map((entry) => entry.candidate.id);
  },
};

/** The production cap in LostFoundService.matches() as of commit a105fd3. */
export const CURRENT_TAKE = 100;

/**
 * The per-candidate scoring of LostFoundService.matches() as of commit a105fd3, copied verbatim so
 * it can still be measured after the new scorer replaces it. As in the service, the query's words
 * and date are computed once per query. current-matches.spec.ts checks this copy against the live
 * service while the two are meant to agree.
 */
export function currentScorer(report: EvalReport): (candidate: EvalReport) => { score: number; reasons: string[] } {
  const reportWords = words(`${report.title} ${report.description}`);
  const reportDate = new Date(`${report.itemDate}T00:00:00Z`).getTime();
  return (candidate) => {
    const candidateWords = words(`${candidate.title} ${candidate.description}`);
    const sharedWords = [...reportWords].filter((word) => candidateWords.has(word)).length;
    const sameLocation = candidate.location.trim().toLocaleLowerCase() === report.location.trim().toLocaleLowerCase();
    const candidateDate = new Date(`${candidate.itemDate}T00:00:00Z`).getTime();
    const daysApart = Math.abs(reportDate - candidateDate) / 86_400_000;
    const sameCategory = candidate.category.trim().toLocaleLowerCase() === report.category.trim().toLocaleLowerCase();
    const score = Math.min(sharedWords * 15, 35)
      + (sameLocation ? 30 : 0)
      + (sameCategory ? 20 : 0)
      + (daysApart <= 1 ? 15 : daysApart <= 3 ? 8 : 0);
    const reasons = [
      ...(sharedWords ? ['Similar description keywords'] : []),
      ...(sameLocation ? ['Same reported location'] : []),
      ...(sameCategory ? ['Same category'] : []),
      ...(daysApart <= 3 ? ['Dates are within 3 days'] : []),
    ];
    return { score, reasons };
  };
}

function rankByCurrentScore(query: EvalReport, candidates: readonly EvalReport[]): string[] {
  const scoreOf = currentScorer(query);
  return candidates
    .filter((candidate) => candidate.id !== query.id)
    .map((candidate) => ({ candidate, score: scoreOf(candidate).score }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || newestFirst(a.candidate, b.candidate))
    .map((entry) => entry.candidate.id);
}

/**
 * The current production algorithm end to end: the database returns the CURRENT_TAKE newest open
 * candidates (ORDER BY createdAt DESC LIMIT 100), and the service scores them, keeps score > 0
 * and sorts by score, newest first on ties.
 */
export const currentMatches: MatchSystem = {
  name: 'current matches()',
  description: `Production algorithm at a105fd3: newest ${CURRENT_TAKE} candidates only, crude weights 35/30/20/15.`,
  select: (pool) => [...pool].sort(newestFirst).slice(0, CURRENT_TAKE),
  rank: rankByCurrentScore,
};

/**
 * Diagnostic only, not a production system: the current scoring over the whole pool, without the
 * newest-100 cap. Separates the cost of the cap from the cost of the crude weights.
 */
export const currentScoringUncapped: MatchSystem = {
  name: 'current, no cap (diagnostic)',
  description: 'The current scoring over every candidate, without the newest-100 cap. Not a production system.',
  rank: rankByCurrentScore,
};

export const SYSTEMS: readonly MatchSystem[] = [keywordBaseline, currentMatches, currentScoringUncapped];
