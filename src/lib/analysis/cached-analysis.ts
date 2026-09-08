import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type { Position, Trade, WalletAnalysis, WalletMetrics, SmartScoreResult, DataReliability } from "@/types/domain";

function explorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

function reliableValue<T>(value: T | null, reliability: DataReliability | null): { value: T | null; reliability: DataReliability } {
  return { value: value ?? null, reliability: reliability ?? "UNAVAILABLE" };
}

function reconstructPosition(row: Record<string, unknown>): Position {
  // unrealized_pnl_usd/unrealized_roi_pct have no dedicated reliability
  // column in the schema (a Phase 1A gap) — inferred from current_price's,
  // since both are always populated together from the same Birdeye response
  // (see birdeye/wallet-analytics.ts getWalletBalances).
  const priceReliability = (row.current_price_reliability as DataReliability) ?? "UNAVAILABLE";
  const unrealizedReliability: DataReliability = priceReliability !== "UNAVAILABLE" ? "PROVIDER_CALCULATED" : "UNAVAILABLE";

  return {
    tokenMint: row.token_mint as string,
    tokenSymbol: row.token_symbol as string | null,
    quantity: row.quantity as number,
    currentPrice: reliableValue(row.current_price_usd as number | null, priceReliability),
    currentValueUsd: reliableValue(row.current_value_usd as number | null, row.current_price_reliability as DataReliability),
    costBasisUsd: reliableValue(row.cost_basis_usd as number | null, row.cost_basis_reliability as DataReliability),
    averageEntryPrice: reliableValue(row.average_entry_price as number | null, row.average_entry_reliability as DataReliability),
    unrealizedPnlUsd: reliableValue(row.unrealized_pnl_usd as number | null, unrealizedReliability),
    unrealizedRoiPct: reliableValue(row.unrealized_roi_pct as number | null, unrealizedReliability),
    firstBuyAt: row.first_buy_at as string | null,
    latestBuyAt: row.latest_buy_at as string | null,
    numBuys: (row.num_buys as number) ?? 0,
    numPartialSells: (row.num_partial_sells as number) ?? 0,
  };
}

function reconstructTrade(row: Record<string, unknown>): Trade {
  return {
    signature: row.tx_signature as string,
    walletAddress: row.wallet_address as string,
    type: row.type as Trade["type"],
    tokenMint: row.token_mint as string,
    tokenSymbol: row.token_symbol as string | null,
    tokenAmount: row.token_amount as number,
    usdValue: reliableValue(row.usd_value as number | null, row.usd_value_reliability as DataReliability),
    executionPrice: reliableValue(row.execution_price as number | null, row.execution_price_reliability as DataReliability),
    realizedPnlUsd: reliableValue(row.realized_pnl_usd as number | null, row.realized_pnl_reliability as DataReliability),
    timestamp: row.occurred_at as string,
    explorerUrl: explorerUrl(row.tx_signature as string),
  };
}

/** Recomputes the same cross-source disagreement note analyzeWallet() surfaces live (see its dataCaveats comment). */
function computeDataCaveats(metrics: WalletMetrics, trades: Trade[]): string[] {
  const classifiedSwapCount = trades.filter((t) => t.type === "DEX_SWAP_BUY" || t.type === "DEX_SWAP_SELL").length;
  if (metrics.tradeCount === 0 && classifiedSwapCount > 0) {
    return [
      `Birdeye reports 0 trades/volume for this wallet in this window, but ${classifiedSwapCount} swaps were found in the recent trade feed below. The Trades/Volume/Win Rate metric cards and Recommended-preset eligibility above reflect Birdeye's aggregate and likely understate real activity.`,
    ];
  }
  return [];
}

/**
 * Reads the last-persisted analysis for a wallet straight from Supabase — no
 * Birdeye/Helius calls. Used so viewing a wallet's page doesn't silently
 * re-run a live analysis (and burn API quota) every single time; the page
 * shows this plus a Refresh button instead. Returns null when nothing has
 * ever been persisted for this wallet+window (first-ever view still needs a
 * live analyzeWallet() call — there's nothing to read yet).
 */
export async function getCachedAnalysis(
  walletAddress: string,
  windowLabel = "90D"
): Promise<WalletAnalysis | null> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;

  const { data: historyRow } = await supabase
    .from("wallet_metric_history")
    .select("snapshot, snapshot_at")
    .eq("wallet_address", walletAddress)
    .eq("window_label", windowLabel)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!historyRow) return null;

  const snapshot = historyRow.snapshot as {
    metrics: WalletMetrics;
    smartScore: SmartScoreResult;
    eligible: boolean;
    rejectionReason: string | null;
  };

  const [{ data: positionRows }, { data: tradeRows }] = await Promise.all([
    // Defensive .gt filter — analyzeWallet() now actively deletes a
    // position's row once a wallet fully exits it (see analyze-wallet.ts),
    // but this guards against any row that went stale before that fix
    // existed, or any future write path that doesn't do the same cleanup.
    supabase.from("wallet_positions").select("*").eq("wallet_address", walletAddress).gt("quantity", 0),
    supabase
      .from("wallet_trades")
      .select("*")
      .eq("wallet_address", walletAddress)
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  const positions = (positionRows ?? []).map(reconstructPosition);
  const trades = (tradeRows ?? []).map(reconstructTrade);

  return {
    walletAddress,
    metrics: snapshot.metrics,
    smartScore: snapshot.smartScore,
    positions,
    trades,
    eligible: snapshot.eligible,
    rejectionReason: snapshot.rejectionReason,
    dataCaveats: computeDataCaveats(snapshot.metrics, trades),
    analyzedAt: historyRow.snapshot_at as string,
  };
}
