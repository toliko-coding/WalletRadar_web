/**
 * Pure selection logic for the exploration/refresh split (Corrective Phase
 * v2, Objective 2) — no I/O, unit-testable without a Supabase connection.
 * See src/lib/jobs/analyze-candidates.ts for the actual queries these
 * decisions feed into.
 */

/**
 * The refresh lane's relevance threshold is deliberately NOT a hardcoded
 * number — it's the minimum `minSmartScore` across every currently-ACTIVE
 * demo_strategies row, computed here rather than duplicating or drifting
 * from any strategy's own configured threshold. Returns `null` when there
 * are no ACTIVE strategies at all (the refresh lane then has nothing to do
 * that cycle — a legitimate no-op, not an error).
 */
export function computeMinActiveSmartScoreThreshold(
  strategies: ReadonlyArray<{ status: "ACTIVE" | "PAUSED"; minSmartScore: number }>
): number | null {
  const activeThresholds = strategies.filter((s) => s.status === "ACTIVE").map((s) => s.minSmartScore);
  if (activeThresholds.length === 0) return null;
  return Math.min(...activeThresholds);
}

/**
 * Whether a wallet's most recent analysis (`computedAt`, from
 * wallet_metrics.computed_at) is old enough to be worth refreshing. A `null`
 * `computedAt` (no analysis on record at all) is never "stale" here — the
 * refresh lane only ever revisits wallets that already have a 90D score;
 * a wallet with no score yet belongs to the exploration lane instead.
 */
export function isStale(computedAt: string | null, stalenessHours: number, now: Date = new Date()): boolean {
  if (computedAt === null) return false;
  const ageHours = (now.getTime() - new Date(computedAt).getTime()) / (60 * 60_000);
  return ageHours >= stalenessHours;
}
