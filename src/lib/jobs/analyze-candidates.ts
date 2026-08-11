import "server-only";
import { analyzeWallet } from "@/lib/analysis/analyze-wallet";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type { TraderType } from "@/types/domain";

function describeError(context: string, error: { message: string } | null): string | null {
  return error ? `${context}: ${error.message}` : null;
}

export interface AnalyzeCandidatesResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

/**
 * System A, analysis half (§4/§23-26, Phase 1D/1E): pulls pending candidates
 * and runs them through the same analyzeWallet() pipeline Phase 1B already
 * built (PnL, classification, cost basis, Smart Score, persistence) — this
 * job only does selection/orchestration, not scoring logic.
 *
 * Default batch size of 10 keeps a single manual trigger under roughly a
 * minute against Birdeye's 1 rps free-tier limit (~4-5 Birdeye calls per
 * wallet). One wallet's failure never aborts the batch.
 */
export async function runAnalyzeCandidates(limit = 10): Promise<AnalyzeCandidatesResult> {
  const startedAt = new Date();
  const supabase = getSupabaseServiceClient();

  if (!supabase) {
    return { processed: 0, succeeded: 0, failed: 0, errors: ["Supabase is not configured"] };
  }

  // Never-analyzed candidates first (last_analyzed_at is null), then the
  // stalest. Doesn't reclaim rows stuck in "analyzing" from a crashed run —
  // acceptable for a manually-triggered batch job at this scale; a real
  // scheduler would need a staleness timeout.
  const { data: candidates, error: selectError } = await supabase
    .from("candidate_wallets")
    .select("wallet_address")
    .neq("analysis_status", "analyzing")
    .order("last_analyzed_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (selectError) {
    return { processed: 0, succeeded: 0, failed: 0, errors: [selectError.message] };
  }

  const errors: string[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const candidate of candidates ?? []) {
    const address = candidate.wallet_address as string;
    const markAnalyzing = await supabase
      .from("candidate_wallets")
      .update({ analysis_status: "analyzing" })
      .eq("wallet_address", address);
    const markAnalyzingError = describeError(`${address}: marking analyzing`, markAnalyzing.error);
    if (markAnalyzingError) errors.push(markAnalyzingError);

    try {
      const { data: walletRow, error: walletSelectError } = await supabase
        .from("wallets")
        .select("trader_type")
        .eq("address", address)
        .maybeSingle();
      if (walletSelectError) throw new Error(`reading known trader_type: ${walletSelectError.message}`);
      const knownType = walletRow?.trader_type as TraderType | undefined;
      const traderTypeHint = knownType && knownType !== "MANUAL_UNKNOWN" ? knownType : undefined;

      const analysis = await analyzeWallet(address, "90D", { traderTypeHint });

      const markAnalyzed = await supabase
        .from("candidate_wallets")
        .update({
          analysis_status: "analyzed",
          eligible: analysis.eligible,
          rejection_reason: analysis.rejectionReason,
          last_analyzed_at: new Date().toISOString(),
        })
        .eq("wallet_address", address);
      if (markAnalyzed.error) throw new Error(`recording analysis result: ${markAnalyzed.error.message}`);
      succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${address}: ${message}`);
      const markFailed = await supabase
        .from("candidate_wallets")
        .update({
          analysis_status: "failed",
          rejection_reason: message,
          last_analyzed_at: new Date().toISOString(),
        })
        .eq("wallet_address", address);
      if (markFailed.error) errors.push(`${address}: marking failed: ${markFailed.error.message}`);
      failed += 1;
    }
  }

  const processed = (candidates ?? []).length;
  const completedAt = new Date();
  await supabase.from("job_runs").insert({
    job_name: "analyze-candidate-wallets",
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    status: errors.length === 0 ? "success" : succeeded > 0 ? "partial" : "failed",
    processed_items: processed,
    errors: errors.length > 0 ? errors : null,
    duration_ms: completedAt.getTime() - startedAt.getTime(),
  });

  return { processed, succeeded, failed, errors };
}
