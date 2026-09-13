import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeWallet } from "@/lib/analysis/analyze-wallet";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { listStrategies } from "@/lib/demo/strategies";
import { RECOMMENDED_EXCLUDED_TRADER_TYPES } from "@/lib/discovery/trader-type";
import { withMaintenanceLock, type LockSkipped } from "@/lib/jobs/maintenance-lock";
import { computeMinActiveSmartScoreThreshold, isStale } from "@/lib/jobs/analyze-lane-selection";
import type { TraderType } from "@/types/domain";

function describeError(context: string, error: { message: string } | null): string | null {
  return error ? `${context}: ${error.message}` : null;
}

export interface AnalyzeCandidatesResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
  /** True only when the global maintenance lock (migration 0007) was already held by a different job — not an error, just "try again next cycle." */
  lockSkipped?: boolean;
}

function emptyResult(errors: string[] = []): AnalyzeCandidatesResult {
  return { processed: 0, succeeded: 0, failed: 0, errors };
}

/**
 * The per-wallet analyze/mark-analyzed loop shared by BOTH lanes
 * (exploration and refresh) — same analyzeWallet() pipeline, same
 * candidate_wallets bookkeeping, differing only in which addresses got
 * selected upstream. One wallet's failure never aborts the batch.
 */
async function analyzeWalletAddresses(supabase: SupabaseClient, addresses: string[]): Promise<{ succeeded: number; failed: number; errors: string[] }> {
  const errors: string[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const address of addresses) {
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

  return { succeeded, failed, errors };
}

async function writeJobRun(
  supabase: SupabaseClient,
  jobName: string,
  startedAt: Date,
  processed: number,
  succeeded: number,
  errors: string[]
): Promise<void> {
  const completedAt = new Date();
  await supabase.from("job_runs").insert({
    job_name: jobName,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    status: errors.length === 0 ? "success" : succeeded > 0 ? "partial" : "failed",
    processed_items: processed,
    errors: errors.length > 0 ? errors : null,
    duration_ms: completedAt.getTime() - startedAt.getTime(),
  });
}

/**
 * Exploration lane (System A, analysis half — §4/§23-26, Phase 1D/1E, now
 * scoped explicitly per the Corrective Phase v2 exploration/refresh split):
 * never-successfully-analyzed candidates only (`pending`/`failed`) — a
 * wallet that already has a score belongs to the refresh lane
 * (runAnalyzeRefreshWallets), not here. Default batch size of 10 keeps a
 * single trigger under roughly a minute against Birdeye's 1 rps free-tier
 * limit (~4-5 Birdeye calls per wallet).
 *
 * Wrapped in the global maintenance lock (migration 0007) — shared with
 * discover-wallets and analyze-refresh-wallets, "only one maintenance job
 * of any type in flight at a time." A lock-skip returns immediately without
 * ever reaching the job_runs write below, so it can never advance this
 * job's due-state timestamp (see withMaintenanceLock's own doc comment).
 */
export async function runAnalyzeCandidates(limit = 10): Promise<AnalyzeCandidatesResult> {
  const result = await withMaintenanceLock("analyze-candidate-wallets", () => runAnalyzeCandidatesUnlocked(limit));
  return isLockSkipped(result) ? { ...emptyResult(), lockSkipped: true } : result;
}

async function runAnalyzeCandidatesUnlocked(limit: number): Promise<AnalyzeCandidatesResult> {
  const startedAt = new Date();
  const supabase = getSupabaseServiceClient();
  if (!supabase) return emptyResult(["Supabase is not configured"]);

  // Explicit exploration scope: `pending` (never analyzed) or `failed` (a
  // prior attempt errored — worth retrying). `analyzing` is transient/
  // in-progress; `analyzed` belongs to the refresh lane once it's stale.
  // Doesn't reclaim rows stuck in "analyzing" from a crashed run —
  // acceptable at this scale; a real scheduler would need a staleness
  // timeout separate from this lane split.
  const { data: candidates, error: selectError } = await supabase
    .from("candidate_wallets")
    .select("wallet_address")
    .in("analysis_status", ["pending", "failed"])
    .order("last_analyzed_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (selectError) return emptyResult([selectError.message]);

  const addresses = (candidates ?? []).map((c) => c.wallet_address as string);
  const { succeeded, failed, errors } = await analyzeWalletAddresses(supabase, addresses);

  await writeJobRun(supabase, "analyze-candidate-wallets", startedAt, addresses.length, succeeded, errors);
  return { processed: addresses.length, succeeded, failed, errors };
}

/**
 * Refresh lane (Corrective Phase v2, Objective 2): re-analyzes wallets that
 * ALREADY matter for Smart Money convergence detection but have gone stale
 * — the exploration lane's own `ORDER BY last_analyzed_at ASC NULLS FIRST`
 * would otherwise never reach them while any never-analyzed candidate still
 * exists (confirmed in the Corrective Phase audit: 609 pending vs. 8
 * relevant wallets, a backlog that only grows). Relevance reuses
 * getConvergenceSignals' own filter verbatim (wallet_metrics.smart_score >=
 * the minimum minSmartScore across ACTIVE strategies, trader_type not
 * excluded) rather than inventing a new threshold — no strategy/scoring
 * change here, just a read of the same numbers strategies already use.
 *
 * No ACTIVE strategies -> nothing is "relevant" -> a genuine, correctly-
 * determined no-op (still writes a completed job_runs row; unlike a
 * lock-skip, this IS real completed work, so it correctly satisfies
 * due-state for this cycle — see the Corrective Phase v2 guardrail on
 * skipped-vs-completed semantics).
 */
export async function runAnalyzeRefreshWallets(limit = 10, stalenessHours = 24): Promise<AnalyzeCandidatesResult> {
  const result = await withMaintenanceLock("analyze-refresh-wallets", () => runAnalyzeRefreshWalletsUnlocked(limit, stalenessHours));
  return isLockSkipped(result) ? { ...emptyResult(), lockSkipped: true } : result;
}

async function runAnalyzeRefreshWalletsUnlocked(limit: number, stalenessHours: number): Promise<AnalyzeCandidatesResult> {
  const startedAt = new Date();
  const supabase = getSupabaseServiceClient();
  if (!supabase) return emptyResult(["Supabase is not configured"]);

  const strategies = await listStrategies();
  const minActiveThreshold = computeMinActiveSmartScoreThreshold(strategies);
  if (minActiveThreshold === null) {
    // No ACTIVE strategy -> nothing is "relevant" to refresh. Genuine,
    // correctly-determined completion, not a skip — see this function's
    // own doc comment.
    await writeJobRun(supabase, "analyze-refresh-wallets", startedAt, 0, 0, []);
    return emptyResult();
  }

  // Same filter getConvergenceSignals uses (window_label '90D', smart_score
  // threshold, excluded trader types) — reused, not reinvented. Fetches a
  // generous multiple of `limit` since a small number of currently-
  // "analyzing" wallets (excluded below) could otherwise under-fill the
  // batch; the relevant pool is small (single digits to low tens) so this
  // stays cheap regardless.
  const { data: staleRows, error: staleError } = await supabase
    .from("wallet_metrics")
    .select("wallet_address, computed_at, wallets!inner(trader_type)")
    .eq("window_label", "90D")
    .gte("smart_score", minActiveThreshold)
    .not("wallets.trader_type", "in", `(${RECOMMENDED_EXCLUDED_TRADER_TYPES.join(",")})`)
    .order("computed_at", { ascending: true })
    .limit(limit * 4);

  if (staleError) return emptyResult([staleError.message]);

  const now = new Date();
  const candidates = (staleRows ?? []).filter((row) => isStale(row.computed_at as string, stalenessHours, now));
  if (candidates.length === 0) {
    // Checked, genuinely nothing stale enough yet — same "real completion,
    // not a skip" reasoning as the no-ACTIVE-strategies case above.
    await writeJobRun(supabase, "analyze-refresh-wallets", startedAt, 0, 0, []);
    return emptyResult();
  }

  // Exclude wallets currently mid-analysis (a small, usually-empty set) —
  // a separate query rather than a 3-way join, matching this codebase's
  // existing convention of light application-level filtering over complex
  // embedded joins.
  const candidateAddresses = candidates.map((c) => c.wallet_address as string);
  const { data: analyzingRows } = await supabase
    .from("candidate_wallets")
    .select("wallet_address")
    .in("wallet_address", candidateAddresses)
    .eq("analysis_status", "analyzing");
  const analyzingSet = new Set((analyzingRows ?? []).map((r) => r.wallet_address as string));

  const addresses = candidateAddresses.filter((a) => !analyzingSet.has(a)).slice(0, limit);
  if (addresses.length === 0) {
    await writeJobRun(supabase, "analyze-refresh-wallets", startedAt, 0, 0, []);
    return emptyResult();
  }

  const { succeeded, failed, errors } = await analyzeWalletAddresses(supabase, addresses);

  await writeJobRun(supabase, "analyze-refresh-wallets", startedAt, addresses.length, succeeded, errors);
  return { processed: addresses.length, succeeded, failed, errors };
}

function isLockSkipped<T>(result: T | LockSkipped): result is LockSkipped {
  return typeof result === "object" && result !== null && "lockSkipped" in result;
}
