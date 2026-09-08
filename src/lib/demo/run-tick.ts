import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { assertNoError } from "@/lib/supabase/assert";
import { birdeyeMarketData } from "@/lib/providers/birdeye/market-data";
import { getConvergenceSignals } from "@/lib/smart-money/data";
import { WRAPPED_SOL_MINT } from "@/lib/classification/classify-transaction";
import {
  simulateFill,
  computePositionQuantity,
  calculateFeeUsd,
  isSignalEligible,
  canOpenNewPosition,
  exceedsMaxAllocation,
  evaluateExit,
  calculateTradePnl,
  calculatePortfolioValuation,
  passesTokenRiskFilters,
  type TokenRiskData,
} from "./engine";
import { getStrategy, getAccount, getOpenPositions, getClosedPositions } from "./strategies";

export interface DemoTickResult {
  strategyId: string;
  signalsConsidered: number;
  positionsOpened: number;
  positionsClosed: number;
  priceCallsMade: number;
  errors: string[];
}

/**
 * One manually-triggered pass of entries -> exits -> snapshot for a single
 * strategy (System B's job, minus the real-time trigger — see supabase/
 * CRON.md and the Phase 1G note in run-tick's callers). Prices are fetched
 * at most once per token per tick (cached in `priceCache`) specifically to
 * keep this cheap: with the current tiny/sparse dataset this typically
 * makes 0-2 live Birdeye calls total (usually just the SOL benchmark).
 */
export async function runDemoTick(strategyId: string): Promise<DemoTickResult> {
  const supabase = getSupabaseServiceClient();
  const errors: string[] = [];
  const priceCache = new Map<string, number | null>();
  let priceCallsMade = 0;

  async function getPrice(mint: string): Promise<number | null> {
    if (priceCache.has(mint)) return priceCache.get(mint) ?? null;
    try {
      const { priceUsd } = await birdeyeMarketData.getTokenPrice(mint);
      priceCallsMade += 1;
      priceCache.set(mint, priceUsd);
      return priceUsd;
    } catch (err) {
      errors.push(`price lookup for ${mint}: ${err instanceof Error ? err.message : String(err)}`);
      priceCache.set(mint, null);
      return null;
    }
  }

  const riskDataCache = new Map<string, TokenRiskData>();
  async function getRiskData(mint: string): Promise<TokenRiskData> {
    const cached = riskDataCache.get(mint);
    if (cached) return cached;
    try {
      const { liquidityUsd, marketCapUsd } = await birdeyeMarketData.getTokenLiquidity(mint);
      priceCallsMade += 1;
      const data = { liquidityUsd, marketCapUsd };
      riskDataCache.set(mint, data);
      return data;
    } catch (err) {
      errors.push(`liquidity/market cap lookup for ${mint}: ${err instanceof Error ? err.message : String(err)}`);
      const data = { liquidityUsd: null, marketCapUsd: null };
      riskDataCache.set(mint, data);
      return data;
    }
  }

  if (!supabase) {
    return { strategyId, signalsConsidered: 0, positionsOpened: 0, positionsClosed: 0, priceCallsMade: 0, errors: ["Supabase is not configured"] };
  }

  const strategy = await getStrategy(strategyId);
  if (!strategy) {
    return { strategyId, signalsConsidered: 0, positionsOpened: 0, positionsClosed: 0, priceCallsMade: 0, errors: [`Strategy ${strategyId} not found`] };
  }
  if (strategy.status !== "ACTIVE") {
    return { strategyId, signalsConsidered: 0, positionsOpened: 0, positionsClosed: 0, priceCallsMade: 0, errors: ["Strategy is paused"] };
  }

  let account = await getAccount(strategyId);
  if (!account) {
    return { strategyId, signalsConsidered: 0, positionsOpened: 0, positionsClosed: 0, priceCallsMade: 0, errors: [`No demo_accounts row for strategy ${strategyId}`] };
  }

  let openPositions = await getOpenPositions(strategyId);
  const now = new Date();

  // --- Exits first: free up allocation/position-count headroom before entries ---
  let positionsClosed = 0;
  for (const position of [...openPositions]) {
    const currentPrice = await getPrice(position.tokenMint);
    if (currentPrice === null) continue; // never guess an exit off a price we don't have

    const decision = evaluateExit(
      {
        stopLossPrice: position.stopLossPrice,
        takeProfitPrice: position.takeProfitPrice,
        maxPositionAgeHours: position.maxPositionAgeHours,
        entryTime: position.entryTime,
      },
      currentPrice,
      now
    );
    if (!decision) continue;

    try {
      const fill = simulateFill(currentPrice, strategy.simulatedSlippagePct, "SELL");
      const proceedsUsd = fill.executionPrice * position.quantity;
      const feesUsd = calculateFeeUsd(proceedsUsd, strategy.feePct);
      const { grossPnlUsd, netPnlUsd } = calculateTradePnl(
        position.entryPrice,
        position.quantity,
        fill.executionPrice,
        position.feesUsd + feesUsd
      );

      const closeResult = await supabase
        .from("demo_positions")
        .update({
          status: "CLOSED",
          exit_rule: decision.rule,
          exit_time: now.toISOString(),
          exit_price: fill.executionPrice,
          fees_usd: position.feesUsd + feesUsd,
          gross_pnl_usd: grossPnlUsd,
          net_pnl_usd: netPnlUsd,
          updated_at: now.toISOString(),
        })
        .eq("id", position.id);
      assertNoError(closeResult, "closing demo position");

      const tradeResult = await supabase.from("demo_trades").insert({
        strategy_id: strategyId,
        position_id: position.id,
        signal_id: position.signalId,
        action: "SELL",
        token_mint: position.tokenMint,
        token_symbol: position.tokenSymbol,
        reference_market_price: currentPrice,
        execution_price: fill.executionPrice,
        simulated_slippage_pct: strategy.simulatedSlippagePct,
        quantity: position.quantity,
        usd_value: proceedsUsd,
        fees_usd: feesUsd,
        gross_pnl_usd: grossPnlUsd,
        net_pnl_usd: netPnlUsd,
        executed_at: now.toISOString(),
      });
      assertNoError(tradeResult, "recording demo SELL trade");

      const newCash: number = account.cashBalanceUsd + proceedsUsd;
      const accountResult = await supabase
        .from("demo_accounts")
        .update({ cash_balance_usd: newCash, updated_at: now.toISOString() })
        .eq("strategy_id", strategyId);
      assertNoError(accountResult, "crediting demo account on exit");
      account = { ...account, cashBalanceUsd: newCash };

      positionsClosed += 1;
    } catch (err) {
      errors.push(`closing position ${position.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  openPositions = await getOpenPositions(strategyId);

  // --- Entries: react to convergence signals detected after this strategy existed ---
  const signals = await getConvergenceSignals({
    minWallets: strategy.minWalletsRequired,
    windowMinutes: strategy.signalWindowMinutes,
    minSmartScore: strategy.minSmartScore,
    lookbackHours: 72,
  });

  let positionsOpened = 0;
  let openPositionCount = openPositions.length;
  const openTokens = new Set(openPositions.map((p) => p.tokenMint));
  // Approximates total portfolio value as cash + (open slots * buy size)
  // rather than fetching every open position's live price just to check an
  // allocation percentage that virtually never binds at this position size —
  // a deliberate accuracy/API-cost trade-off, not an oversight.
  const approxPortfolioValueUsd = account.cashBalanceUsd + openPositionCount * strategy.virtualBuySizeUsd;

  for (const signal of signals) {
    // "Detection time" is the instant this tick actually processes the
    // signal — the one honest anti-look-ahead check available without a
    // continuous monitoring loop (Phase 1G): a strategy created after this
    // tick would run could never have produced this position.
    const detectionTime = now.toISOString();
    if (!isSignalEligible(detectionTime, strategy.createdAt)) continue;
    if (openTokens.has(signal.tokenMint)) continue; // already holding this token — don't stack a second position on the same live signal
    if (!canOpenNewPosition(openPositionCount, strategy.maxOpenPositions)) break;
    if (exceedsMaxAllocation(0, strategy.virtualBuySizeUsd, approxPortfolioValueUsd, strategy.maxAllocationPctPerToken)) continue;
    if (account.cashBalanceUsd < strategy.virtualBuySizeUsd) continue; // out of virtual cash

    // §43 — don't blindly paper-buy every token a wallet touches. Only
    // fetched when the strategy actually configured a filter, so a strategy
    // with none of these set costs nothing extra here.
    const hasRiskFilters =
      strategy.minTokenLiquidityUsd !== null || strategy.minMarketCapUsd !== null || strategy.maxMarketCapUsd !== null;
    if (hasRiskFilters) {
      const riskData = await getRiskData(signal.tokenMint);
      if (
        !passesTokenRiskFilters(riskData, {
          minTokenLiquidityUsd: strategy.minTokenLiquidityUsd,
          minMarketCapUsd: strategy.minMarketCapUsd,
          maxMarketCapUsd: strategy.maxMarketCapUsd,
        })
      ) {
        continue;
      }
    }

    const currentPrice = await getPrice(signal.tokenMint);
    if (currentPrice === null) continue; // never fabricate an entry price

    try {
      const fill = simulateFill(currentPrice, strategy.simulatedSlippagePct, "BUY");
      const quantity = computePositionQuantity(strategy.virtualBuySizeUsd, fill.executionPrice);
      const feesUsd = calculateFeeUsd(strategy.virtualBuySizeUsd, strategy.feePct);

      const signalResult = await supabase
        .from("demo_signals")
        .insert({
          strategy_id: strategyId,
          token_mint: signal.tokenMint,
          token_symbol: signal.tokenSymbol,
          triggering_wallets: signal.wallets,
          average_smart_score: signal.averageSmartScore,
          wallet_count: signal.walletCount,
          signal_time: signal.firstBuyAt,
          detection_time: detectionTime,
          market_price_at_detection: currentPrice,
        })
        .select()
        .single();
      assertNoError(signalResult, "recording demo signal");
      const signalId = (signalResult.data as { id: string }).id;

      const positionResult = await supabase
        .from("demo_positions")
        .insert({
          strategy_id: strategyId,
          signal_id: signalId,
          token_mint: signal.tokenMint,
          token_symbol: signal.tokenSymbol,
          status: "OPEN",
          entry_price: fill.executionPrice,
          quantity,
          position_size_usd: strategy.virtualBuySizeUsd,
          entry_time: detectionTime,
          stop_loss_price: strategy.stopLossPct !== null ? fill.executionPrice * (1 - strategy.stopLossPct / 100) : null,
          take_profit_price: strategy.takeProfitPct !== null ? fill.executionPrice * (1 + strategy.takeProfitPct / 100) : null,
          max_position_age_hours: strategy.maxPositionAgeHours,
          fees_usd: feesUsd,
        })
        .select()
        .single();
      assertNoError(positionResult, "opening demo position");
      const positionId = (positionResult.data as { id: string }).id;

      const tradeResult = await supabase.from("demo_trades").insert({
        strategy_id: strategyId,
        position_id: positionId,
        signal_id: signalId,
        action: "BUY",
        token_mint: signal.tokenMint,
        token_symbol: signal.tokenSymbol,
        reference_market_price: currentPrice,
        execution_price: fill.executionPrice,
        simulated_slippage_pct: strategy.simulatedSlippagePct,
        quantity,
        usd_value: strategy.virtualBuySizeUsd,
        fees_usd: feesUsd,
        executed_at: detectionTime,
      });
      assertNoError(tradeResult, "recording demo BUY trade");

      const newCash: number = account.cashBalanceUsd - strategy.virtualBuySizeUsd;
      const accountResult = await supabase
        .from("demo_accounts")
        .update({ cash_balance_usd: newCash, updated_at: detectionTime })
        .eq("strategy_id", strategyId);
      assertNoError(accountResult, "debiting demo account on entry");
      account = { ...account, cashBalanceUsd: newCash };

      openTokens.add(signal.tokenMint);
      openPositionCount += 1;
      positionsOpened += 1;
    } catch (err) {
      errors.push(`opening position for ${signal.tokenMint}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Snapshot: mark-to-market every open position, sum every closed one ---
  try {
    const finalOpenPositions = await getOpenPositions(strategyId);
    const closedPositions = await getClosedPositions(strategyId, 10_000);

    const openForValuation = await Promise.all(
      finalOpenPositions.map(async (p) => ({
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        currentPrice: await getPrice(p.tokenMint),
      }))
    );

    const valuation = calculatePortfolioValuation(
      account.cashBalanceUsd,
      strategy.startingCapitalUsd,
      openForValuation,
      closedPositions.map((p) => ({ netPnlUsd: p.netPnlUsd ?? 0 }))
    );

    const snapshotResult = await supabase.from("demo_portfolio_snapshots").insert({
      strategy_id: strategyId,
      snapshot_at: now.toISOString(),
      cash_balance_usd: valuation.cashBalanceUsd,
      open_position_value_usd: valuation.openPositionValueUsd,
      total_value_usd: valuation.totalValueUsd,
      realized_pnl_usd: valuation.realizedPnlUsd,
      unrealized_pnl_usd: valuation.unrealizedPnlUsd,
      total_pnl_usd: valuation.totalPnlUsd,
      roi_pct: valuation.roiPct,
    });
    assertNoError(snapshotResult, "recording demo portfolio snapshot");

    // Opportunistic SOL benchmark (§37) — BTC isn't a Solana token, so
    // Birdeye can't price it; BTC benchmarking needs a separate,
    // non-Solana price source this project doesn't integrate yet.
    const solPrice = await getPrice(WRAPPED_SOL_MINT);
    if (solPrice !== null) {
      const benchmarkResult = await supabase.from("benchmarks").insert({
        symbol: "SOL",
        price_usd: solPrice,
        recorded_at: now.toISOString(),
      });
      assertNoError(benchmarkResult, "recording SOL benchmark");
    }
  } catch (err) {
    errors.push(`snapshot: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    strategyId,
    signalsConsidered: signals.length,
    positionsOpened,
    positionsClosed,
    priceCallsMade,
    errors,
  };
}
