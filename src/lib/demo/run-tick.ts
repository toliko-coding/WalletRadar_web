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
import { resolveOrCreateEvent, type ResolvedEvent } from "@/lib/validation/events-data";
import { recordEvaluation, type SignalDecision } from "@/lib/validation/evaluations-data";
import { recordObservation } from "@/lib/validation/observations-data";
import { findMintsNeedingBackfill } from "@/lib/validation/backfill";

export interface SkippedSignal {
  tokenMint: string;
  tokenSymbol: string | null;
  reason: string;
}

export interface DemoTickResult {
  strategyId: string;
  signalsConsidered: number;
  positionsOpened: number;
  positionsClosed: number;
  priceCallsMade: number;
  skippedSignals: SkippedSignal[];
  /** How many token_market_data rows the bounded observation-backfill step wrote this tick (plan §D) — separate from the opportunistic logging every normal getPrice/getRiskData call also does. */
  outcomeObservationsRecorded: number;
  /** Genuine new Birdeye calls attributable specifically to the backfill step — 0 whenever every candidate mint was already covered by a call this tick made for another reason, or by the underlying 30s cache. */
  outcomePriceCallsMade: number;
  errors: string[];
}

// Bounds the one deliberate new source of Birdeye calls this feature
// introduces (plan §D/§I) — always small, always visible in the result.
const OBSERVATION_BACKFILL_MINT_CAP = 8;

/**
 * One manually-triggered pass of entries -> exits -> snapshot for a single
 * strategy (System B's job, minus the real-time trigger — see supabase/
 * CRON.md and the Phase 1G note in run-tick's callers). Prices are fetched
 * at most once per token per tick (cached in `priceCache`) specifically to
 * keep this cheap: with the current tiny/sparse dataset this typically
 * makes 0-2 live Birdeye calls total (usually just the SOL benchmark), plus
 * up to OBSERVATION_BACKFILL_MINT_CAP more for the bounded backfill step.
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
      // Opportunistic, zero-marginal-cost market observation (plan §D) —
      // logs the price this call already paid for, regardless of whether
      // any signal/event cares about this mint. Never blocks the trading
      // decision this price is actually being fetched for.
      if (priceUsd !== null) {
        try {
          await recordObservation({ tokenMint: mint, priceUsd, fetchedAt: new Date().toISOString() });
        } catch (err) {
          errors.push(`recording market observation for ${mint}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
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
      // Liquidity/market-cap-only observation — price_usd left null, so
      // this row is never picked up by horizon-return resolution (which
      // reads price_usd only), but it's available for a future "liquidity
      // near detection" display. Opportunistic, same zero-marginal-cost
      // reasoning as getPrice above.
      if (liquidityUsd !== null || marketCapUsd !== null) {
        try {
          await recordObservation({ tokenMint: mint, priceUsd: null, liquidityUsd, marketCapUsd, fetchedAt: new Date().toISOString() });
        } catch (err) {
          errors.push(`recording liquidity observation for ${mint}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return data;
    } catch (err) {
      errors.push(`liquidity/market cap lookup for ${mint}: ${err instanceof Error ? err.message : String(err)}`);
      const data = { liquidityUsd: null, marketCapUsd: null };
      riskDataCache.set(mint, data);
      return data;
    }
  }

  if (!supabase) {
    return { strategyId, signalsConsidered: 0, positionsOpened: 0, positionsClosed: 0, priceCallsMade: 0, skippedSignals: [], outcomeObservationsRecorded: 0, outcomePriceCallsMade: 0, errors: ["Supabase is not configured"] };
  }

  const strategy = await getStrategy(strategyId);
  if (!strategy) {
    return { strategyId, signalsConsidered: 0, positionsOpened: 0, positionsClosed: 0, priceCallsMade: 0, skippedSignals: [], outcomeObservationsRecorded: 0, outcomePriceCallsMade: 0, errors: [`Strategy ${strategyId} not found`] };
  }
  if (strategy.status !== "ACTIVE") {
    return { strategyId, signalsConsidered: 0, positionsOpened: 0, positionsClosed: 0, priceCallsMade: 0, skippedSignals: [], outcomeObservationsRecorded: 0, outcomePriceCallsMade: 0, errors: ["Strategy is paused"] };
  }

  let account = await getAccount(strategyId);
  if (!account) {
    return { strategyId, signalsConsidered: 0, positionsOpened: 0, positionsClosed: 0, priceCallsMade: 0, skippedSignals: [], outcomeObservationsRecorded: 0, outcomePriceCallsMade: 0, errors: [`No demo_accounts row for strategy ${strategyId}`] };
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
  // Lookback must always comfortably exceed the convergence window itself
  // (plus a buffer) — a fixed 72h here would silently miss valid signals
  // for any strategy configured with a wider signalWindowMinutes than that,
  // since the window-clustering logic can only see trades this lookback
  // actually fetched.
  const lookbackHours = Math.max(72, Math.ceil(strategy.signalWindowMinutes / 60) + 24);
  const signals = await getConvergenceSignals({
    minWallets: strategy.minWalletsRequired,
    windowMinutes: strategy.signalWindowMinutes,
    minSmartScore: strategy.minSmartScore,
    lookbackHours,
  });

  let positionsOpened = 0;
  let openPositionCount = openPositions.length;
  const openTokens = new Set(openPositions.map((p) => p.tokenMint));
  // Approximates total portfolio value as cash + (open slots * buy size)
  // rather than fetching every open position's live price just to check an
  // allocation percentage that virtually never binds at this position size —
  // a deliberate accuracy/API-cost trade-off, not an oversight.
  const approxPortfolioValueUsd = account.cashBalanceUsd + openPositionCount * strategy.virtualBuySizeUsd;

  // Surfaced to the UI so a strategy that opens nothing isn't a silent black
  // box — every signal the pipeline actually found is accounted for, either
  // as an opened position or a skip with a concrete reason.
  const skippedSignals: SkippedSignal[] = [];
  function skip(signal: (typeof signals)[number], reason: string) {
    skippedSignals.push({ tokenMint: signal.tokenMint, tokenSymbol: signal.tokenSymbol, reason });
  }

  // Durable counterpart to skip() — resolves/merges the canonical
  // convergence_events row for this signal and records this strategy's
  // decision about it (demo_signal_evaluations), at most once per
  // (strategy, event) pair ever. Entirely Supabase reads/writes, zero
  // provider calls, and deliberately best-effort: a failure here must never
  // abort or skip an actual trade — it's caught and reported in `errors`,
  // never rethrown into the entries loop's own control flow.
  async function recordDecision(
    signal: (typeof signals)[number],
    decision: SignalDecision,
    marketPriceAtDetection: number | null,
    demoSignalId: string | null
  ): Promise<ResolvedEvent | null> {
    try {
      const event = await resolveOrCreateEvent(
        { tokenMint: signal.tokenMint, signalTime: signal.firstBuyAt, wallets: signal.wallets },
        signal.tokenSymbol,
        marketPriceAtDetection
      );
      if (!event) return null; // Supabase not configured
      await recordEvaluation({
        strategyId,
        eventId: event.id,
        decision,
        qualifyingWalletCount: signal.walletCount,
        qualifyingAvgSmartScore: signal.averageSmartScore,
        evaluatedAt: now.toISOString(), // this tick's "now" — the forward-only anchor horizon matching resolves against
        demoSignalId,
      });
      return event;
    } catch (err) {
      errors.push(`recording signal evaluation for ${signal.tokenMint}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  for (const signal of signals) {
    // "Detection time" is the instant this tick actually processes the
    // signal — the one honest anti-look-ahead check available without a
    // continuous monitoring loop (Phase 1G): a strategy created after this
    // tick would run could never have produced this position.
    const detectionTime = now.toISOString();
    if (!isSignalEligible(detectionTime, strategy.createdAt)) {
      skip(signal, "signal predates this strategy's creation (no backdating)");
      // Recorded purely as a strategy-behavior audit trail (proof the
      // strategy correctly refused to backdate itself) — SKIPPED_PREDATES_
      // STRATEGY is excluded from every signal-/strategy-quality statistic
      // by definition (src/lib/validation/evaluations-data.ts).
      await recordDecision(signal, "SKIPPED_PREDATES_STRATEGY", null, null);
      continue;
    }
    if (openTokens.has(signal.tokenMint)) {
      skip(signal, "already holding an open position in this token");
      await recordDecision(signal, "SKIPPED_ALREADY_HOLDING", null, null);
      continue;
    }
    if (!canOpenNewPosition(openPositionCount, strategy.maxOpenPositions)) {
      skip(signal, `max open positions reached (${strategy.maxOpenPositions})`);
      await recordDecision(signal, "SKIPPED_MAX_POSITIONS", null, null);
      continue;
    }
    if (exceedsMaxAllocation(0, strategy.virtualBuySizeUsd, approxPortfolioValueUsd, strategy.maxAllocationPctPerToken)) {
      skip(signal, `would exceed max allocation per token (${strategy.maxAllocationPctPerToken}%)`);
      await recordDecision(signal, "SKIPPED_ALLOCATION", null, null);
      continue;
    }
    if (account.cashBalanceUsd < strategy.virtualBuySizeUsd) {
      skip(signal, "insufficient virtual cash");
      await recordDecision(signal, "SKIPPED_INSUFFICIENT_CASH", null, null);
      continue;
    }

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
        skip(signal, "failed token risk filters (liquidity/market cap)");
        await recordDecision(signal, "SKIPPED_RISK_FILTER", null, null);
        continue;
      }
    }

    const currentPrice = await getPrice(signal.tokenMint);
    if (currentPrice === null) {
      skip(signal, "no live price available"); // never fabricate an entry price
      await recordDecision(signal, "SKIPPED_NO_PRICE", null, null);
      continue;
    }

    try {
      const fill = simulateFill(currentPrice, strategy.simulatedSlippagePct, "BUY");
      const quantity = computePositionQuantity(strategy.virtualBuySizeUsd, fill.executionPrice);
      const feesUsd = calculateFeeUsd(strategy.virtualBuySizeUsd, strategy.feePct);

      // Resolved before the demo_signals insert so the trade can carry its
      // originating event's id (nullable event handled below); guarded in
      // its own try/catch — a validation-bookkeeping failure must never
      // block an actual trade.
      let event: ResolvedEvent | null = null;
      try {
        event = await resolveOrCreateEvent(
          { tokenMint: signal.tokenMint, signalTime: signal.firstBuyAt, wallets: signal.wallets },
          signal.tokenSymbol,
          currentPrice
        );
      } catch (err) {
        errors.push(`resolving convergence event for ${signal.tokenMint}: ${err instanceof Error ? err.message : String(err)}`);
      }

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
          event_id: event?.id ?? null,
        })
        .select()
        .single();
      assertNoError(signalResult, "recording demo signal");
      const signalId = (signalResult.data as { id: string }).id;

      if (event) {
        try {
          await recordEvaluation({
            strategyId,
            eventId: event.id,
            decision: "TRADED",
            qualifyingWalletCount: signal.walletCount,
            qualifyingAvgSmartScore: signal.averageSmartScore,
            evaluatedAt: detectionTime,
            demoSignalId: signalId,
          });
        } catch (err) {
          errors.push(`recording TRADED evaluation for ${signal.tokenMint}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

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

  // --- Bounded market-observation backfill (§D/§I) — the one deliberate new
  // source of Birdeye calls this whole feature introduces. Global across
  // every strategy's evaluations (token_market_data is a shared ledger, so
  // one fetch here can resolve gaps for every strategy that's ever
  // evaluated an event on that token), strictly capped, and its cost is
  // always reported below rather than hidden inside the general
  // priceCallsMade total.
  let outcomeObservationsRecorded = 0;
  let outcomePriceCallsMade = 0;
  try {
    // findMintsNeedingBackfill also returns each mint's token_symbol, but
    // getPrice's shared closure has no per-call symbol parameter (it's used
    // from many call sites that don't have one in hand) — the tokens row it
    // writes via recordObservation is symbol: null in that case. Harmless:
    // tokens.symbol is cosmetic bookkeeping only, never read by horizon
    // resolution, so this is left as a known simplification rather than
    // threading a symbol through every getPrice call site for this one use.
    const candidates = await findMintsNeedingBackfill(now.toISOString(), OBSERVATION_BACKFILL_MINT_CAP);
    for (const { tokenMint } of candidates) {
      // getPrice's early-return on a same-tick cache hit skips its own
      // recordObservation call entirely (nothing new to log — the
      // observation from whichever earlier call populated the cache
      // already exists), so a cache hit here contributes neither a new
      // Birdeye call nor a new observation row. Both counters must reflect
      // that, not just "did a price resolve."
      const alreadyFetchedThisTick = priceCache.has(tokenMint);
      const callsBefore = priceCallsMade;
      const price = await getPrice(tokenMint);
      if (!alreadyFetchedThisTick) {
        outcomePriceCallsMade += priceCallsMade - callsBefore;
        if (price !== null) outcomeObservationsRecorded += 1;
      }
    }
  } catch (err) {
    errors.push(`observation backfill: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    strategyId,
    signalsConsidered: signals.length,
    positionsOpened,
    positionsClosed,
    priceCallsMade,
    skippedSignals,
    outcomeObservationsRecorded,
    outcomePriceCallsMade,
    errors,
  };
}
