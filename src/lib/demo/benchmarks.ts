import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface BenchmarkComparison {
  strategyRoiPct: number | null;
  solRoiPct: number | null;
  /** BTC isn't a Solana token — Birdeye can't price it, and no other price source is integrated yet (§37 known gap). */
  btcRoiPct: null;
}

/**
 * Compares the strategy's latest snapshot ROI against SOL's ROI over the
 * same period (§37) — the whole point of Demo mode is checking whether
 * following signals actually beats just holding SOL. Uses the earliest and
 * latest `benchmarks` rows recorded since the strategy was created; those
 * rows are only written opportunistically (once per tick — see run-tick.ts),
 * so this needs at least two ticks to produce a real comparison.
 */
export async function getBenchmarkComparison(strategyId: string, strategyCreatedAt: string, latestRoiPct: number | null): Promise<BenchmarkComparison> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { strategyRoiPct: latestRoiPct, solRoiPct: null, btcRoiPct: null };

  const { data: solRows } = await supabase
    .from("benchmarks")
    .select("price_usd, recorded_at")
    .eq("symbol", "SOL")
    .gte("recorded_at", strategyCreatedAt)
    .order("recorded_at", { ascending: true });

  if (!solRows || solRows.length < 2) {
    return { strategyRoiPct: latestRoiPct, solRoiPct: null, btcRoiPct: null };
  }

  const first = solRows[0].price_usd as number;
  const last = solRows[solRows.length - 1].price_usd as number;
  const solRoiPct = first > 0 ? ((last - first) / first) * 100 : null;

  return { strategyRoiPct: latestRoiPct, solRoiPct, btcRoiPct: null };
}
