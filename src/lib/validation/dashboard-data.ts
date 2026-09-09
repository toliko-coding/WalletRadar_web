import "server-only";
import { listEvents, type EventSummary, type ListEventsCriteria } from "./events-data";
import { listEvaluations, EXCLUDED_FROM_STATISTICS, type SignalDecision } from "./evaluations-data";
import { getObservationsForToken, type StoredObservation } from "./observations-data";
import { listStrategies } from "@/lib/demo/strategies";
import {
  HORIZON_DEFINITIONS,
  toRelativeObservations,
  resolveHorizonReturn,
  computeHorizonCoverage,
  computeHeadlineStats,
  type ResolvedReturn,
  type HorizonCoverage,
  type HorizonHeadlineStats,
} from "./horizons";

export interface HorizonResult {
  key: string;
  label: string;
  coverage: HorizonCoverage;
  headline: HorizonHeadlineStats;
}

export interface SignalQualityData {
  eventCount: number;
  horizons: HorizonResult[];
  events: EventSummary[];
}

/**
 * Signal-quality statistics (plan §F) — computed by iterating
 * convergence_events directly, de-duplicated by construction (one row per
 * real-world occurrence regardless of how many strategies have evaluated
 * it), never demo_signal_evaluations. Every event's horizon returns are
 * resolved against ITS OWN `firstRecordedAt` (WalletRadar's own detection
 * timestamp) — never `signalTime` (a wallet's historical on-chain trade
 * time), which would violate forward-only integrity. Headline stats
 * (mean/median/win-rate/n) are computed from RESOLVED_ON_TIME results only
 * — RESOLVED_EARLY_APPROX never enters them, only the coverage counts.
 * Pure DB reads — zero provider calls.
 */
export async function getSignalQualityData(criteria: ListEventsCriteria = {}): Promise<SignalQualityData> {
  const events = await listEvents(criteria);

  const observationsByMint = new Map<string, StoredObservation[]>();
  async function observationsFor(mint: string, sinceIso: string): Promise<StoredObservation[]> {
    const cached = observationsByMint.get(mint);
    if (cached) return cached;
    const rows = await getObservationsForToken(mint, sinceIso);
    observationsByMint.set(mint, rows);
    return rows;
  }

  const perHorizon = new Map<string, ResolvedReturn[]>(HORIZON_DEFINITIONS.map((h) => [h.key, []]));

  for (const event of events) {
    const rows = await observationsFor(event.tokenMint, event.firstRecordedAt);
    const relative = toRelativeObservations(rows, event.firstRecordedAt);
    for (const horizon of HORIZON_DEFINITIONS) {
      perHorizon.get(horizon.key)!.push(resolveHorizonReturn(relative, horizon));
    }
  }

  const horizons: HorizonResult[] = HORIZON_DEFINITIONS.map((h) => {
    const results = perHorizon.get(h.key)!;
    const coverage = computeHorizonCoverage(results);
    const onTimeOnly = results.filter((r) => r.status === "RESOLVED_ON_TIME");
    return { key: h.key, label: h.label, coverage, headline: computeHeadlineStats(onTimeOnly) };
  });

  return { eventCount: events.length, horizons, events };
}

export interface StrategyDecisionBreakdown {
  strategyId: string;
  strategyName: string;
  counts: Partial<Record<SignalDecision, number>>;
  total: number;
}

/**
 * Strategy-quality decision breakdown (plan §G) — computed by iterating
 * demo_signal_evaluations grouped by strategy_id, a different data source
 * and a different question from getSignalQualityData above ("given
 * capital/risk constraints, what happened when Strategy X chose to trade"
 * vs. "did the underlying signal predict price"). SKIPPED_PREDATES_
 * STRATEGY is shown here as a raw audit count (never a rate/percentage
 * that could mislead) but must never feed EXCLUDED_FROM_STATISTICS-gated
 * calculations elsewhere.
 */
export async function getStrategyDecisionBreakdown(): Promise<StrategyDecisionBreakdown[]> {
  const [evaluations, strategies] = await Promise.all([listEvaluations(), listStrategies()]);
  const nameById = new Map(strategies.map((s) => [s.id, s.name]));

  const byStrategy = new Map<string, Partial<Record<SignalDecision, number>>>();
  for (const evaluation of evaluations) {
    const counts = byStrategy.get(evaluation.strategyId) ?? {};
    counts[evaluation.decision] = (counts[evaluation.decision] ?? 0) + 1;
    byStrategy.set(evaluation.strategyId, counts);
  }

  return [...byStrategy.entries()].map(([strategyId, counts]) => ({
    strategyId,
    strategyName: nameById.get(strategyId) ?? strategyId,
    counts,
    total: Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0),
  }));
}

export { EXCLUDED_FROM_STATISTICS };
