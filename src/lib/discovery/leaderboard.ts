import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { nullableGteFilter, nullableLteFilter, inListLiteral } from "@/lib/discovery/query-filters";
import type { FilterCriteria } from "@/lib/discovery/presets";
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

/**
 * Powers the /dashboard leaderboard (§14), filtered by a resolved preset or
 * custom FilterCriteria (§6-8). Empty array when Supabase isn't configured
 * or nothing matches — never fabricated rows.
 */
export async function getLeaderboard(
  windowLabel: string,
  criteria: FilterCriteria
): Promise<LeaderboardRow[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];

  // Typed as `any` deliberately: PostgrestFilterBuilder's generics grow with
  // every chained call, and reassigning through conditional branches below
  // (`query = query.eq(...)`) makes TS try to re-derive the full type at each
  // step, blowing past its instantiation-depth limit ("Type instantiation is
  // excessively deep and possibly infinite"). Runtime shape is unaffected —
  // the result is cast field-by-field in the .map() below regardless.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("wallet_metrics")
    .select(
      "wallet_address, smart_score, realized_pnl_usd, realized_pnl_reliability, roi_pct, win_rate_pct, trade_count, volume_usd, max_drawdown_pct, trading_history_days, last_activity_at, risk_level, wallets!inner(trader_type)"
    )
    .eq("window_label", windowLabel)
    .not("smart_score", "is", null)
    .gte("trade_count", criteria.minTrades)
    .gte("volume_usd", criteria.minVolumeUsd)
    .gte("win_rate_pct", criteria.minWinRatePct)
    .gte("realized_pnl_usd", criteria.minPnlUsd)
    .or(nullableLteFilter("max_drawdown_pct", criteria.maxDrawdownPct))
    .or(nullableGteFilter("trading_history_days", criteria.minTradingHistoryDays))
    .or(nullableGteFilter("roi_pct", criteria.minRoiPct))
    .or(nullableGteFilter("avg_trade_size_usd", criteria.minAvgTradeSizeUsd));

  // Unlike the other metrics above, a null last_activity_at isn't an
  // unmeasurable-but-real value — for an already-analyzed wallet it means no
  // qualifying trade was ever found, which a "recently active" filter should
  // treat as failing, not passing through.
  const cutoff = new Date(Date.now() - criteria.recentActivityDays * 24 * 60 * 60 * 1000).toISOString();
  query = query.gte("last_activity_at", cutoff);

  if (criteria.riskLevel !== "ALL") {
    query = query.eq("risk_level", criteria.riskLevel);
  }
  if (criteria.traderType !== "ALL") {
    query = query.eq("wallets.trader_type", criteria.traderType);
  }
  if (criteria.excludeTraderTypes.length > 0) {
    query = query.not("wallets.trader_type", "in", inListLiteral(criteria.excludeTraderTypes));
  }

  const { data }: { data: Record<string, unknown>[] | null } = await query
    .order("smart_score", { ascending: false })
    .limit(criteria.limit);

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
