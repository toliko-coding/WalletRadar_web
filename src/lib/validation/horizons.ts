/**
 * Pure horizon-matching and headline-statistics logic for Signal / Strategy
 * Validation. No I/O — everything here operates on already-fetched
 * observation lists so it's fully unit-testable and reusable from both the
 * validation dashboard and (later, unmodified by this file) any backfill
 * bookkeeping.
 *
 * Core rule (the anti-optimism-bias rule from the approved plan): a horizon
 * outcome prefers the earliest observation AT OR AFTER its target minute —
 * never an earlier one, even if numerically closer — because an
 * observation that hasn't actually reached the target elapsed time could
 * still be inside a move that later reverses. Only when nothing at-or-after
 * exists within tolerance do we fall back to the closest earlier
 * observation, and that fallback is flagged as a distinct, lower-confidence
 * status (RESOLVED_EARLY_APPROX) that must never be silently mixed into
 * on-time headline statistics (see computeHeadlineStats).
 */

export interface HorizonDefinition {
  key: string;
  label: string;
  targetMinutes: number;
  minAcceptableMinutes: number;
  maxAcceptableMinutes: number;
}

/**
 * The five research horizons plus an internal "at detection" baseline used
 * only to resolve the reference price a return is computed from — never
 * shown to the user as one of "the horizons," just the t=0 anchor. Treating
 * it through the exact same resolution rule as every forward horizon (rather
 * than a special case) keeps the return calculation honest: if no price was
 * ever observed near evaluation time (e.g. a signal skipped before any
 * price lookup ran), the return is UNAVAILABLE, never assumed/backfilled.
 */
export const BASELINE_HORIZON: HorizonDefinition = {
  key: "baseline",
  label: "at detection",
  targetMinutes: 0,
  minAcceptableMinutes: 0,
  maxAcceptableMinutes: 5,
};

export const HORIZON_DEFINITIONS: HorizonDefinition[] = [
  { key: "5m", label: "5m", targetMinutes: 5, minAcceptableMinutes: 3, maxAcceptableMinutes: 10 },
  { key: "15m", label: "15m", targetMinutes: 15, minAcceptableMinutes: 10, maxAcceptableMinutes: 25 },
  { key: "1h", label: "1h", targetMinutes: 60, minAcceptableMinutes: 45, maxAcceptableMinutes: 90 },
  { key: "4h", label: "4h", targetMinutes: 240, minAcceptableMinutes: 180, maxAcceptableMinutes: 300 },
  { key: "24h", label: "24h", targetMinutes: 1440, minAcceptableMinutes: 1200, maxAcceptableMinutes: 1800 },
];

export interface PriceObservation {
  minutesSinceEvaluation: number;
  priceUsd: number;
}

/**
 * Converts raw stored observations (absolute timestamps) into the
 * evaluation-relative shape `resolveHorizonOutcome` operates on. Kept pure
 * (no I/O) so it's testable independent of how the rows were fetched.
 */
export function toRelativeObservations(
  rows: Array<{ priceUsd: number; observedAt: string }>,
  anchorIso: string
): PriceObservation[] {
  const anchorMs = new Date(anchorIso).getTime();
  return rows.map((r) => ({
    minutesSinceEvaluation: (new Date(r.observedAt).getTime() - anchorMs) / 60_000,
    priceUsd: r.priceUsd,
  }));
}

export type HorizonOutcomeStatus = "RESOLVED_ON_TIME" | "RESOLVED_EARLY_APPROX" | "UNAVAILABLE";

export interface HorizonOutcome {
  status: HorizonOutcomeStatus;
  observation: PriceObservation | null;
  actualMinutesElapsed: number | null;
}

/** Deterministic, pure. See module doc for the selection rule. */
export function resolveHorizonOutcome(
  observations: PriceObservation[],
  horizon: HorizonDefinition
): HorizonOutcome {
  const inWindow = observations.filter(
    (o) => o.minutesSinceEvaluation >= horizon.minAcceptableMinutes && o.minutesSinceEvaluation <= horizon.maxAcceptableMinutes
  );
  if (inWindow.length === 0) {
    return { status: "UNAVAILABLE", observation: null, actualMinutesElapsed: null };
  }

  const atOrAfter = inWindow
    .filter((o) => o.minutesSinceEvaluation >= horizon.targetMinutes)
    .sort((a, b) => a.minutesSinceEvaluation - b.minutesSinceEvaluation);
  if (atOrAfter.length > 0) {
    const observation = atOrAfter[0];
    return { status: "RESOLVED_ON_TIME", observation, actualMinutesElapsed: observation.minutesSinceEvaluation };
  }

  const before = inWindow
    .filter((o) => o.minutesSinceEvaluation < horizon.targetMinutes)
    .sort((a, b) => b.minutesSinceEvaluation - a.minutesSinceEvaluation);
  const observation = before[0];
  return { status: "RESOLVED_EARLY_APPROX", observation, actualMinutesElapsed: observation.minutesSinceEvaluation };
}

export interface ResolvedReturn {
  status: HorizonOutcomeStatus;
  returnPct: number | null;
  baselinePriceUsd: number | null;
  outcomePriceUsd: number | null;
  actualMinutesElapsed: number | null;
}

/**
 * Resolves a horizon's return given an explicit, already-known baseline
 * price (e.g. an event's `market_price_at_first_detection`, or a trade's
 * own entry price) plus an observation list for the forward side.
 *
 * A known baseline is preferred over re-deriving "the price at t=0" by
 * searching observations near the anchor: the founding observation for a
 * freshly-created event is written by a price-fetch call that necessarily
 * completes *before* the event row's own timestamp is set (the write order
 * is: fetch price -> resolve/create event), so a query for observations
 * `>= anchor` can systematically miss it by a fraction of a second. Passing
 * the price that's already stored avoids that race entirely. When no known
 * baseline is available (`knownBaselinePriceUsd` is null — e.g. an event
 * whose first-ever detection had no price in hand), falls back to matching
 * BASELINE_HORIZON against the observation list, same as any other horizon.
 *
 * The returned `status` mirrors the *forward* horizon's status
 * (RESOLVED_ON_TIME / RESOLVED_EARLY_APPROX) — an early-approx baseline
 * paired with an on-time forward observation is treated as on-time, since
 * the baseline horizon's own tolerance window ([0,5]) makes "early vs. late"
 * largely moot for a t=0 anchor.
 */
export function resolveHorizonReturn(
  knownBaselinePriceUsd: number | null,
  observations: PriceObservation[],
  horizon: HorizonDefinition
): ResolvedReturn {
  const baselinePriceUsd =
    knownBaselinePriceUsd ?? resolveHorizonOutcome(observations, BASELINE_HORIZON).observation?.priceUsd ?? null;
  const outcome = resolveHorizonOutcome(observations, horizon);

  if (baselinePriceUsd === null || outcome.status === "UNAVAILABLE") {
    return { status: "UNAVAILABLE", returnPct: null, baselinePriceUsd: null, outcomePriceUsd: null, actualMinutesElapsed: null };
  }

  const outcomePriceUsd = outcome.observation!.priceUsd;
  const returnPct = baselinePriceUsd > 0 ? ((outcomePriceUsd - baselinePriceUsd) / baselinePriceUsd) * 100 : null;

  return {
    status: outcome.status,
    returnPct,
    baselinePriceUsd,
    outcomePriceUsd,
    actualMinutesElapsed: outcome.actualMinutesElapsed,
  };
}

/**
 * Whether a given evaluation could still benefit from more observations —
 * true when at least one horizon's acceptable window hasn't fully closed
 * yet (elapsed time hasn't passed its max bound) AND that horizon doesn't
 * already have an on-time resolution. Once a horizon's window has closed,
 * no future observation can change its outcome (whether that outcome ended
 * up RESOLVED_EARLY_APPROX or UNAVAILABLE), so it's excluded from this
 * check regardless of status. Used to bound the opportunistic
 * observation-backfill step (plan §D) to mints that can still be helped.
 */
export function needsMoreObservations(evaluatedAtIso: string, observations: PriceObservation[], nowIso: string): boolean {
  const elapsedMinutes = (new Date(nowIso).getTime() - new Date(evaluatedAtIso).getTime()) / 60_000;
  return HORIZON_DEFINITIONS.some((horizon) => {
    const windowStillOpen = elapsedMinutes <= horizon.maxAcceptableMinutes;
    if (!windowStillOpen) return false;
    return resolveHorizonOutcome(observations, horizon).status !== "RESOLVED_ON_TIME";
  });
}

export interface HorizonCoverage {
  onTimeCount: number;
  earlyOnlyCount: number;
  unavailableCount: number;
}

export function computeHorizonCoverage(results: ResolvedReturn[]): HorizonCoverage {
  let onTimeCount = 0;
  let earlyOnlyCount = 0;
  let unavailableCount = 0;
  for (const r of results) {
    if (r.status === "RESOLVED_ON_TIME") onTimeCount += 1;
    else if (r.status === "RESOLVED_EARLY_APPROX") earlyOnlyCount += 1;
    else unavailableCount += 1;
  }
  return { onTimeCount, earlyOnlyCount, unavailableCount };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type SampleConfidence = "insufficient" | "low" | "moderate" | "strong";

/** Buckets, not a real confidence interval — deliberately simple, see plan §L/§C.4. */
export function classifySampleConfidence(n: number): SampleConfidence {
  if (n < 10) return "insufficient";
  if (n < 30) return "low";
  if (n < 100) return "moderate";
  return "strong";
}

export interface HorizonHeadlineStats {
  n: number;
  positiveCount: number;
  positivePct: number | null;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  confidence: SampleConfidence;
  hasOutlier: boolean;
}

/**
 * The hard rule from the approved plan: headline stats are computed from
 * RESOLVED_ON_TIME results ONLY. RESOLVED_EARLY_APPROX results must never
 * reach this function's input array — callers should route them only to
 * computeHorizonCoverage's diagnostic count instead.
 */
export function computeHeadlineStats(onTimeResults: ResolvedReturn[], outlierThresholdMultiple = 5): HorizonHeadlineStats {
  const returns = onTimeResults
    .filter((r) => r.status === "RESOLVED_ON_TIME" && r.returnPct !== null)
    .map((r) => r.returnPct as number);

  const n = returns.length;
  if (n === 0) {
    return {
      n: 0,
      positiveCount: 0,
      positivePct: null,
      meanReturnPct: null,
      medianReturnPct: null,
      confidence: classifySampleConfidence(0),
      hasOutlier: false,
    };
  }

  const positiveCount = returns.filter((r) => r > 0).length;
  const meanReturnPct = returns.reduce((sum, r) => sum + r, 0) / n;
  const medianReturnPct = median(returns);

  return {
    n,
    positiveCount,
    positivePct: (positiveCount / n) * 100,
    meanReturnPct,
    medianReturnPct,
    confidence: classifySampleConfidence(n),
    hasOutlier: hasReturnOutlier(returns, medianReturnPct, outlierThresholdMultiple),
  };
}

/**
 * A single extreme meme-token return can dominate a mean of a handful of
 * signals. Deliberately simple (a ratio check against the median), not a
 * full robust-statistics framework — just enough to flag "the mean above
 * may be misleading, look at the median/distribution instead."
 */
export function hasReturnOutlier(returns: number[], medianReturnPct: number, thresholdMultiple = 5): boolean {
  if (returns.length < 2) return false;
  // A near-zero median makes "large multiple of the median" undefined —
  // rather than flag everything (or nothing) misleadingly, this heuristic
  // simply doesn't apply in that degenerate case.
  if (Math.abs(medianReturnPct) < 1e-9) return false;
  const maxAbs = Math.max(...returns.map((r) => Math.abs(r)));
  return maxAbs > Math.abs(medianReturnPct) * thresholdMultiple;
}
