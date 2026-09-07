/**
 * Pure paper-trading engine (§26-43) — no I/O, no Date.now() defaults (the
 * caller always passes "now" explicitly) so every rule here is exactly
 * reproducible in a test. This is where the two most important safety
 * properties of the whole Demo system live:
 *
 * 1. NO LOOK-AHEAD (§30/§39): a simulated fill always uses the reference
 *    price handed to it (the price observed at DETECTION time), never a
 *    source wallet's historical trade price. isSignalEligible() additionally
 *    refuses any signal detected before the strategy existed — no
 *    backdating a strategy onto favorable history that already happened.
 * 2. NO FREE LUNCH (§31/§32): every simulated fill pays simulated slippage;
 *    every close can carry a fee. A backtest-shaped bug here (e.g. filling
 *    at the exact reference price) would make results look better than any
 *    real execution ever could.
 */

export type ExitRuleTriggered = "STOP_LOSS" | "TAKE_PROFIT" | "MAX_HOLDING_PERIOD";

export interface SimulatedFill {
  referencePrice: number;
  executionPrice: number;
  slippagePct: number;
}

export function simulateFill(
  referencePrice: number,
  slippagePct: number,
  side: "BUY" | "SELL"
): SimulatedFill {
  if (referencePrice <= 0) throw new Error("referencePrice must be positive");
  if (slippagePct < 0) throw new Error("slippagePct must not be negative");
  // A BUY always pays slightly more than the reference price; a SELL always
  // receives slightly less — slippage must never work in the simulator's
  // favor, or every result would be systematically too optimistic.
  const factor = side === "BUY" ? 1 + slippagePct / 100 : 1 - slippagePct / 100;
  return { referencePrice, executionPrice: referencePrice * factor, slippagePct };
}

export function computePositionQuantity(positionSizeUsd: number, executionPrice: number): number {
  if (executionPrice <= 0) throw new Error("executionPrice must be positive");
  if (positionSizeUsd <= 0) throw new Error("positionSizeUsd must be positive");
  return positionSizeUsd / executionPrice;
}

export function calculateFeeUsd(usdValue: number, feePct: number): number {
  return Math.max(0, usdValue) * Math.max(0, feePct / 100);
}

/** §39 — no retroactive fills. Strictly after, not >=, so the exact instant a strategy is created can't itself count. */
export function isSignalEligible(detectionTime: string, strategyCreatedAt: string): boolean {
  return new Date(detectionTime).getTime() > new Date(strategyCreatedAt).getTime();
}

export function canOpenNewPosition(currentOpenCount: number, maxOpenPositions: number): boolean {
  return currentOpenCount < maxOpenPositions;
}

/**
 * True when adding a position of `newPositionSizeUsd` to a token that
 * already has `existingAllocationUsd` invested would breach
 * `maxAllocationPct` of total portfolio value.
 */
export function exceedsMaxAllocation(
  existingAllocationUsd: number,
  newPositionSizeUsd: number,
  portfolioValueUsd: number,
  maxAllocationPct: number
): boolean {
  if (portfolioValueUsd <= 0) return false; // nothing to evaluate a percentage of yet — don't block the very first position
  const projectedPct = ((existingAllocationUsd + newPositionSizeUsd) / portfolioValueUsd) * 100;
  return projectedPct > maxAllocationPct;
}

export interface OpenPositionForExitCheck {
  entryPrice: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  maxPositionAgeHours: number | null;
  entryTime: string;
}

export interface ExitEvaluation {
  rule: ExitRuleTriggered;
  reason: string;
}

/**
 * Checked in a fixed priority order — stop-loss first (capital preservation
 * takes precedence), then take-profit, then max holding period. A position
 * that could plausibly trigger two rules at once (rare, but possible right
 * at a boundary) always reports the risk-control one.
 */
export function evaluateExit(
  position: OpenPositionForExitCheck,
  currentPrice: number,
  now: Date
): ExitEvaluation | null {
  if (currentPrice <= 0) throw new Error("currentPrice must be positive");

  if (position.stopLossPct !== null) {
    const stopPrice = position.entryPrice * (1 - position.stopLossPct / 100);
    if (currentPrice <= stopPrice) {
      return {
        rule: "STOP_LOSS",
        reason: `Price ${currentPrice} hit the stop-loss level ${stopPrice.toFixed(8)} (-${position.stopLossPct}% from entry)`,
      };
    }
  }

  if (position.takeProfitPct !== null) {
    const targetPrice = position.entryPrice * (1 + position.takeProfitPct / 100);
    if (currentPrice >= targetPrice) {
      return {
        rule: "TAKE_PROFIT",
        reason: `Price ${currentPrice} hit the take-profit level ${targetPrice.toFixed(8)} (+${position.takeProfitPct}% from entry)`,
      };
    }
  }

  if (position.maxPositionAgeHours !== null) {
    const ageHours = (now.getTime() - new Date(position.entryTime).getTime()) / (1000 * 60 * 60);
    if (ageHours >= position.maxPositionAgeHours) {
      return {
        rule: "MAX_HOLDING_PERIOD",
        reason: `Position age ${ageHours.toFixed(1)}h reached the ${position.maxPositionAgeHours}h max holding period`,
      };
    }
  }

  return null;
}

export interface TradePnl {
  grossPnlUsd: number;
  netPnlUsd: number;
}

export function calculateTradePnl(
  entryPrice: number,
  quantity: number,
  exitPrice: number,
  totalFeesUsd: number
): TradePnl {
  const grossPnlUsd = (exitPrice - entryPrice) * quantity;
  return { grossPnlUsd, netPnlUsd: grossPnlUsd - totalFeesUsd };
}

export interface OpenPositionValuation {
  entryPrice: number;
  quantity: number;
  currentPrice: number | null; // null when a live price couldn't be fetched — never assume $0 or entry price
}

export interface ClosedPositionForPortfolio {
  netPnlUsd: number;
}

export interface PortfolioValuation {
  cashBalanceUsd: number;
  openPositionValueUsd: number;
  totalValueUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  roiPct: number;
}

/**
 * §35/§36 — the equity curve is built from snapshots of this, never
 * reconstructed from current positions alone after the fact. An open
 * position with no live price available contributes $0 exposure/PnL rather
 * than a guess — the reliability gap should be visible upstream (as an
 * UNAVAILABLE-tagged price on the position), not silently smoothed over
 * here.
 */
export function calculatePortfolioValuation(
  cashBalanceUsd: number,
  startingCapitalUsd: number,
  openPositions: OpenPositionValuation[],
  closedPositions: ClosedPositionForPortfolio[]
): PortfolioValuation {
  const openPositionValueUsd = openPositions.reduce(
    (sum, p) => sum + (p.currentPrice !== null ? p.currentPrice * p.quantity : 0),
    0
  );
  const unrealizedPnlUsd = openPositions.reduce(
    (sum, p) => sum + (p.currentPrice !== null ? (p.currentPrice - p.entryPrice) * p.quantity : 0),
    0
  );
  const realizedPnlUsd = closedPositions.reduce((sum, p) => sum + p.netPnlUsd, 0);
  const totalValueUsd = cashBalanceUsd + openPositionValueUsd;
  const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;
  const roiPct = startingCapitalUsd > 0 ? (totalPnlUsd / startingCapitalUsd) * 100 : 0;

  return {
    cashBalanceUsd,
    openPositionValueUsd,
    totalValueUsd,
    realizedPnlUsd,
    unrealizedPnlUsd,
    totalPnlUsd,
    roiPct,
  };
}
