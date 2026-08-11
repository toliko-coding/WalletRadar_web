import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type { DataReliability, RiskLevel } from "@/types/domain";

export interface LeaderboardRow {
  walletAddress: string;
  smartScore: number;
  realizedPnlUsd: number | null;
  realizedPnlReliability: DataReliability;
  roiPct: number | null;
  winRatePct: number | null;
  tradeCount: number;
  volumeUsd: number | null;
  maxDrawdownPct: number | null;
  maxDrawdownReliability: DataReliability;
  tradingHistoryDays: number | null;
  lastActivityAt: string | null;
  riskLevel: RiskLevel | null;
}

/** Powers the /dashboard leaderboard (§14). Empty array when Supabase isn't configured or nothing's been scored yet. */
export async function getLeaderboard(windowLabel = "90D", limit = 10): Promise<LeaderboardRow[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("wallet_metrics")
    .select(
      "wallet_address, smart_score, realized_pnl_usd, realized_pnl_reliability, roi_pct, win_rate_pct, trade_count, volume_usd, max_drawdown_pct, trading_history_days, last_activity_at, risk_level"
    )
    .eq("window_label", windowLabel)
    .not("smart_score", "is", null)
    .order("smart_score", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    walletAddress: row.wallet_address as string,
    smartScore: (row.smart_score as number) ?? 0,
    realizedPnlUsd: row.realized_pnl_usd as number | null,
    realizedPnlReliability: (row.realized_pnl_reliability as DataReliability) ?? "UNAVAILABLE",
    roiPct: row.roi_pct as number | null,
    winRatePct: row.win_rate_pct as number | null,
    tradeCount: (row.trade_count as number) ?? 0,
    volumeUsd: row.volume_usd as number | null,
    maxDrawdownPct: row.max_drawdown_pct as number | null,
    maxDrawdownReliability: row.max_drawdown_pct !== null ? "ESTIMATED" : "UNAVAILABLE",
    tradingHistoryDays: row.trading_history_days as number | null,
    lastActivityAt: row.last_activity_at as string | null,
    riskLevel: (row.risk_level as RiskLevel | null) ?? null,
  }));
}
