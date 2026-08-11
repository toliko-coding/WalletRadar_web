import "server-only";
import { birdeyeWalletAnalytics, getWalletPnlChart } from "@/lib/providers/birdeye/wallet-analytics";
import { heliusTransactions } from "@/lib/providers/helius/transactions";
import { calculateSmartScore } from "@/lib/scoring/smart-score";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { assertNoError } from "@/lib/supabase/assert";
import { RECOMMENDED_EXCLUDED_TRADER_TYPES } from "@/lib/discovery/trader-type";
import type { Position, RiskLevel, TraderType, WalletAnalysis } from "@/types/domain";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Recommended preset defaults (§6/7) — the only preset available until the
// filters panel (Phase 1E/1F) exists. Applied here purely as an informational
// eligibility check, not a hard gate.
const RECOMMENDED = {
  minTrades: 50,
  minVolumeUsd: 10_000,
  minWinRatePct: 55,
  maxDrawdownPct: 30,
  recentActivityDays: 7,
};

export interface AnalyzeWalletOptions {
  /**
   * A trader type already known from discovery (Birdeye's wallet_tags on a
   * top-traders response — see src/lib/discovery/trader-type.ts). Manual
   * single-wallet lookups (the /discover analyzer, direct /wallet/[address]
   * visits) have no such hint and default to MANUAL_UNKNOWN, same as before.
   */
  traderTypeHint?: TraderType;
}

export function isValidSolanaAddress(address: string): boolean {
  return SOLANA_ADDRESS_RE.test(address);
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function computeProfitConcentration(
  profitByToken: Array<{ tokenMint: string; tokenSymbol: string | null; profitUsd: number }>
): { pct: number | null; tokenSymbol: string | null } {
  const winners = profitByToken.filter((t) => t.profitUsd > 0);
  const totalWinnerProfit = winners.reduce((sum, t) => sum + t.profitUsd, 0);
  if (totalWinnerProfit <= 0 || winners.length === 0) return { pct: null, tokenSymbol: null };

  const top = winners.reduce((max, t) => (t.profitUsd > max.profitUsd ? t : max), winners[0]);
  return { pct: (top.profitUsd / totalWinnerProfit) * 100, tokenSymbol: top.tokenSymbol };
}

function computeMaxDrawdownPct(chartPoints: Array<{ realized_pnl: number }>): number | null {
  if (chartPoints.length < 2) return null;
  let peak = chartPoints[0].realized_pnl;
  let maxDrawdown = 0;
  for (const point of chartPoints) {
    peak = Math.max(peak, point.realized_pnl);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - point.realized_pnl) / peak);
    }
  }
  return peak > 0 ? maxDrawdown * 100 : null;
}

function riskLevelFromDrawdown(drawdownPct: number | null): RiskLevel {
  if (drawdownPct === null) return "MEDIUM"; // unknown risk defaults conservative, not LOW
  if (drawdownPct >= 40) return "HIGH";
  if (drawdownPct >= 20) return "MEDIUM";
  return "LOW";
}

/**
 * Helius's Enhanced Transactions API doesn't return a token symbol, only the
 * mint — classifyTransaction() always leaves Trade.tokenSymbol null. Fill it
 * in from Birdeye's per-token PnL breakdown, which the wallet's full trading
 * history already covers (not just currently-held tokens), so historical
 * sells show a symbol too. Mints Birdeye hasn't seen stay null — the UI
 * falls back to a shortened address rather than guessing a symbol.
 */
function enrichTradeSymbols(
  trades: WalletAnalysis["trades"],
  profitByToken: Array<{ tokenMint: string; tokenSymbol: string | null }>
): WalletAnalysis["trades"] {
  const symbolByMint = new Map(profitByToken.map((t) => [t.tokenMint, t.tokenSymbol]));
  return trades.map((trade) => {
    const symbol = symbolByMint.get(trade.tokenMint);
    return symbol ? { ...trade, tokenSymbol: symbol } : trade;
  });
}

/** Enriches Birdeye's current-holdings positions with first/latest-buy timestamps found in the (bounded) trade feed. */
function enrichPositionsWithTradeTimestamps(
  positions: Position[],
  trades: WalletAnalysis["trades"]
): Position[] {
  return positions.map((position) => {
    const buys = trades
      .filter((t) => t.tokenMint === position.tokenMint && t.type === "DEX_SWAP_BUY")
      .map((t) => t.timestamp)
      .sort();
    if (buys.length === 0) return position;
    return {
      ...position,
      firstBuyAt: buys[0],
      latestBuyAt: buys[buys.length - 1],
    };
  });
}

export async function analyzeWallet(
  walletAddress: string,
  windowLabel: string = "90D",
  options: AnalyzeWalletOptions = {}
): Promise<WalletAnalysis> {
  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error(`"${walletAddress}" is not a valid Solana wallet address`);
  }

  // Each of these is fetched independently and degrades to an empty/neutral
  // result on failure — one endpoint being unavailable (permission tier,
  // transient error, etc.) must never take down the whole analysis. Only
  // getWalletPnL is allowed to throw: without it there's nothing useful to
  // show anyway, and the caller (Route Handler / page) surfaces that clearly.
  const [pnlWindow, rawPositions, profitByToken, chartPoints, trades] = await Promise.all([
    birdeyeWalletAnalytics.getWalletPnL(walletAddress, windowLabel),
    birdeyeWalletAnalytics.getWalletBalances(walletAddress).catch(() => []),
    birdeyeWalletAnalytics.getWalletProfitByToken(walletAddress).catch(() => []),
    getWalletPnlChart(walletAddress).catch(() => []),
    heliusTransactions.getWalletTransactions(walletAddress, { limit: 50 }).catch(() => []),
  ]);

  const positions = enrichPositionsWithTradeTimestamps(rawPositions, trades);
  const enrichedTrades = enrichTradeSymbols(trades, profitByToken);
  const { pct: profitConcentrationPct, tokenSymbol: concentrationTokenSymbol } =
    computeProfitConcentration(profitByToken);
  const maxDrawdownPct = computeMaxDrawdownPct(chartPoints);

  const lastActivityAt = trades[0]?.timestamp ?? null;
  const lastActivityDaysAgo = daysAgo(lastActivityAt);

  // Bounded by Birdeye's 100-day pnl-chart cap — an approximation of history,
  // not a true first-transaction date (§11 known limitation).
  const tradingHistoryDays =
    chartPoints.length >= 2
      ? (new Date(chartPoints[chartPoints.length - 1].timestamp).getTime() -
          new Date(chartPoints[0].timestamp).getTime()) /
        (1000 * 60 * 60 * 24)
      : null;

  const riskLevel = riskLevelFromDrawdown(maxDrawdownPct);
  const traderType = options.traderTypeHint ?? "MANUAL_UNKNOWN";

  const metrics = {
    ...pnlWindow.metrics,
    lastActivityAt,
    tradingHistoryDays,
    walletAgeDays: null, // requires a full historical scan (Phase 1C) — never fabricated
    maxDrawdownPct: { value: maxDrawdownPct, reliability: maxDrawdownPct !== null ? ("ESTIMATED" as const) : ("UNAVAILABLE" as const) },
    profitConcentrationPct: {
      value: profitConcentrationPct,
      reliability: profitConcentrationPct !== null ? ("CALCULATED" as const) : ("UNAVAILABLE" as const),
    },
    profitConcentrationTokenSymbol: concentrationTokenSymbol,
    riskLevel,
    traderType,
  };

  const smartScore = calculateSmartScore({
    realizedPnlUsd: metrics.realizedPnlUsd.value,
    unrealizedPnlUsd: metrics.unrealizedPnlUsd.value,
    roiPct: metrics.roiPct.value,
    winRatePct: metrics.winRatePct.value,
    tradeCount: metrics.tradeCount,
    avgTradeSizeUsd: metrics.avgTradeSizeUsd.value,
    profitConcentrationPct,
    maxDrawdownPct,
    tradingHistoryDays,
    lastActivityDaysAgo,
    pnlSeries: chartPoints.map((p) => p.realized_pnl),
  });

  const volumeUsd = metrics.volumeUsd.value ?? 0;
  const failedCriteria: string[] = [];
  if (metrics.tradeCount < RECOMMENDED.minTrades) failedCriteria.push(`fewer than ${RECOMMENDED.minTrades} trades`);
  if (volumeUsd < RECOMMENDED.minVolumeUsd) failedCriteria.push(`volume below $${RECOMMENDED.minVolumeUsd.toLocaleString()}`);
  if ((metrics.winRatePct.value ?? 0) < RECOMMENDED.minWinRatePct) failedCriteria.push(`win rate below ${RECOMMENDED.minWinRatePct}%`);
  if (maxDrawdownPct !== null && maxDrawdownPct > RECOMMENDED.maxDrawdownPct) failedCriteria.push(`drawdown above ${RECOMMENDED.maxDrawdownPct}%`);
  if (lastActivityDaysAgo !== null && lastActivityDaysAgo > RECOMMENDED.recentActivityDays) failedCriteria.push(`no trades in the last ${RECOMMENDED.recentActivityDays} days`);
  if ((RECOMMENDED_EXCLUDED_TRADER_TYPES as readonly string[]).includes(traderType)) {
    failedCriteria.push(`tagged ${traderType.toLowerCase().replace("_", " ")}`);
  }

  // Birdeye's pnl/summary occasionally returns all-zero aggregate counts for
  // a wallet even when pnl/details and the live trade feed both show real
  // activity (observed for high-frequency SOL/USDC market makers — likely an
  // indexing gap on Birdeye's side, not something we can fix). Never silently
  // blend the two counts into one "corrected" number — that would fabricate
  // a figure neither source actually returned. Surface the disagreement
  // instead, since the metric cards above and rejection reason both derive
  // from the (possibly understated) Birdeye aggregate.
  const dataCaveats: string[] = [];
  const classifiedSwapCount = enrichedTrades.filter(
    (t) => t.type === "DEX_SWAP_BUY" || t.type === "DEX_SWAP_SELL"
  ).length;
  if (metrics.tradeCount === 0 && classifiedSwapCount > 0) {
    dataCaveats.push(
      `Birdeye reports 0 trades/volume for this wallet in this window, but ${classifiedSwapCount} swaps were found in the recent trade feed below. The Trades/Volume/Win Rate metric cards and Recommended-preset eligibility above reflect Birdeye's aggregate and likely understate real activity.`
    );
  }

  const analysis: WalletAnalysis = {
    walletAddress,
    metrics,
    smartScore,
    positions,
    trades: enrichedTrades,
    eligible: failedCriteria.length === 0,
    rejectionReason: failedCriteria.length > 0 ? failedCriteria.join("; ") : null,
    dataCaveats,
    analyzedAt: new Date().toISOString(),
  };

  await persistBestEffort(analysis, options.traderTypeHint !== undefined);
  return analysis;
}

async function persistBestEffort(analysis: WalletAnalysis, hasTraderTypeHint: boolean): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;

  try {
    const walletsResult = await supabase.from("wallets").upsert({
      address: analysis.walletAddress,
      risk_level: analysis.metrics.riskLevel,
      // Only overwrite trader_type when this call actually supplied a fresh
      // hint (from discovery). A plain manual re-analysis must not clobber a
      // trader_type discovery already established with the "no idea" default.
      ...(hasTraderTypeHint ? { trader_type: analysis.metrics.traderType } : {}),
      updated_at: new Date().toISOString(),
    });
    assertNoError(walletsResult, "upserting wallets");

    const metricsResult = await supabase.from("wallet_metrics").upsert(
      {
        wallet_address: analysis.walletAddress,
        window_label: analysis.metrics.windowLabel,
        realized_pnl_usd: analysis.metrics.realizedPnlUsd.value,
        realized_pnl_reliability: analysis.metrics.realizedPnlUsd.reliability,
        unrealized_pnl_usd: analysis.metrics.unrealizedPnlUsd.value,
        unrealized_pnl_reliability: analysis.metrics.unrealizedPnlUsd.reliability,
        total_pnl_usd: analysis.metrics.totalPnlUsd.value,
        roi_pct: analysis.metrics.roiPct.value,
        win_rate_pct: analysis.metrics.winRatePct.value,
        trade_count: analysis.metrics.tradeCount,
        volume_usd: analysis.metrics.volumeUsd.value,
        avg_trade_size_usd: analysis.metrics.avgTradeSizeUsd.value,
        max_drawdown_pct: analysis.metrics.maxDrawdownPct.value,
        trading_history_days: analysis.metrics.tradingHistoryDays,
        last_activity_at: analysis.metrics.lastActivityAt,
        profit_concentration_pct: analysis.metrics.profitConcentrationPct.value,
        profit_concentration_token_symbol: analysis.metrics.profitConcentrationTokenSymbol,
        risk_level: analysis.metrics.riskLevel,
        smart_score: analysis.smartScore.score,
        smart_score_breakdown: analysis.smartScore,
        computed_at: analysis.analyzedAt,
      },
      { onConflict: "wallet_address,window_label" }
    );
    assertNoError(metricsResult, "upserting wallet_metrics");

    if (analysis.positions.length > 0) {
      const positionsResult = await supabase.from("wallet_positions").upsert(
        analysis.positions.map((position) => ({
          wallet_address: analysis.walletAddress,
          token_mint: position.tokenMint,
          token_symbol: position.tokenSymbol,
          quantity: position.quantity,
          current_price_usd: position.currentPrice.value,
          current_price_reliability: position.currentPrice.reliability,
          current_value_usd: position.currentValueUsd.value,
          cost_basis_usd: position.costBasisUsd.value,
          cost_basis_reliability: position.costBasisUsd.reliability,
          average_entry_price: position.averageEntryPrice.value,
          average_entry_reliability: position.averageEntryPrice.reliability,
          unrealized_pnl_usd: position.unrealizedPnlUsd.value,
          unrealized_roi_pct: position.unrealizedRoiPct.value,
          first_buy_at: position.firstBuyAt,
          latest_buy_at: position.latestBuyAt,
          num_buys: position.numBuys,
          num_partial_sells: position.numPartialSells,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "wallet_address,token_mint" }
      );
      assertNoError(positionsResult, "upserting wallet_positions");
    }

    if (analysis.trades.length > 0) {
      const tradesResult = await supabase.from("wallet_trades").upsert(
        analysis.trades.map((trade) => ({
          wallet_address: analysis.walletAddress,
          tx_signature: trade.signature,
          type: trade.type,
          token_mint: trade.tokenMint,
          token_symbol: trade.tokenSymbol,
          token_amount: trade.tokenAmount,
          usd_value: trade.usdValue.value,
          usd_value_reliability: trade.usdValue.reliability,
          execution_price: trade.executionPrice.value,
          execution_price_reliability: trade.executionPrice.reliability,
          realized_pnl_usd: trade.realizedPnlUsd.value,
          realized_pnl_reliability: trade.realizedPnlUsd.reliability,
          occurred_at: trade.timestamp,
        })),
        { onConflict: "wallet_address,tx_signature,instruction_index" }
      );
      assertNoError(tradesResult, "upserting wallet_trades");
    }
  } catch (err) {
    // Best-effort only — persistence failures never block the analyzer
    // response, but must not vanish silently either (that's exactly how a
    // Postgres grants gap went undetected earlier — see supabase/migrations/
    // 0002_grants.sql). Logged, not rethrown.
    console.error(`[persistBestEffort] failed for ${analysis.walletAddress}:`, err);
  }
}
