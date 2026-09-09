import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { assertNoError } from "@/lib/supabase/assert";

export type SignalDecision =
  | "TRADED"
  | "SKIPPED_ALREADY_HOLDING"
  | "SKIPPED_MAX_POSITIONS"
  | "SKIPPED_ALLOCATION"
  | "SKIPPED_INSUFFICIENT_CASH"
  | "SKIPPED_RISK_FILTER"
  | "SKIPPED_NO_PRICE"
  | "SKIPPED_PREDATES_STRATEGY";

/**
 * SKIPPED_PREDATES_STRATEGY exists purely as a strategy-behavior audit
 * record (proof the strategy correctly refused to backdate itself onto old
 * history) — every signal-quality and strategy-quality statistic MUST
 * exclude rows with this decision. Callers computing aggregates over
 * demo_signal_evaluations should filter through this constant, not
 * hand-roll the exclusion.
 */
export const EXCLUDED_FROM_STATISTICS: SignalDecision[] = ["SKIPPED_PREDATES_STRATEGY"];

export interface RecordEvaluationInput {
  strategyId: string;
  eventId: string;
  decision: SignalDecision;
  qualifyingWalletCount: number;
  qualifyingAvgSmartScore: number | null;
  evaluatedAt: string;
  demoSignalId?: string | null;
}

/**
 * Records a strategy's decision about an event, at most once per
 * (strategy, event) pair ever. `ignoreDuplicates` on the
 * (strategy_id, event_id) unique constraint makes every later re-detection
 * of an already-evaluated event a silent no-op — the first tick that sees
 * an event decides for that strategy, fixing the re-detection duplication
 * trap (getConvergenceSignals has no memory of prior detections). Zero
 * provider calls — pure Supabase write.
 */
export async function recordEvaluation(input: RecordEvaluationInput): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;

  const result = await supabase.from("demo_signal_evaluations").upsert(
    {
      strategy_id: input.strategyId,
      event_id: input.eventId,
      decision: input.decision,
      qualifying_wallet_count: input.qualifyingWalletCount,
      qualifying_avg_smart_score: input.qualifyingAvgSmartScore,
      evaluated_at: input.evaluatedAt,
      demo_signal_id: input.demoSignalId ?? null,
    },
    { onConflict: "strategy_id,event_id", ignoreDuplicates: true }
  );
  assertNoError(result, "recording demo signal evaluation");
}
