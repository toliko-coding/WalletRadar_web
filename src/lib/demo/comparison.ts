import "server-only";
import { calculateMaxDrawdownPct, calculatePortfolioValuation } from "./engine";
import { getBenchmarkComparison } from "./benchmarks";
import { listStrategies, getAccount, getOpenPositions, getClosedPositions, getSnapshots } from "./strategies";
import type { DemoStrategy } from "./types";

export interface StrategyComparisonRow {
  strategy: DemoStrategy;
  currentValueUsd: number;
  totalPnlUsd: number;
  roiPct: number;
  maxDrawdownPct: number | null;
  closedTradeCount: number;
  openPositionCount: number;
  winRatePct: number | null;
  /** Sum of winning trades' net PnL / |sum of losing trades' net PnL|. Null when there are no losses to divide by (undefined, not infinite). */
  profitFactor: number | null;
  solRoiPct: number | null;
}

/**
 * §38 "Strategy Experiments" — lets multiple strategies with different
 * discovery/convergence criteria run side by side and be compared without
 * ever mixing their results (each strategy's rows are scoped by strategy_id
 * throughout). Pure DB reads, no live API calls.
 */
export async function getStrategyComparison(): Promise<StrategyComparisonRow[]> {
  const strategies = await listStrategies();

  return Promise.all(
    strategies.map(async (strategy) => {
      const [account, openPositions, closedPositions, snapshots] = await Promise.all([
        getAccount(strategy.id),
        getOpenPositions(strategy.id),
        getClosedPositions(strategy.id, 10_000),
        getSnapshots(strategy.id, 2_000),
      ]);

      const latestSnapshot = snapshots[snapshots.length - 1] ?? null;
      const valuation =
        latestSnapshot ??
        calculatePortfolioValuation(
          account?.cashBalanceUsd ?? strategy.startingCapitalUsd,
          strategy.startingCapitalUsd,
          [],
          closedPositions.map((p) => ({ netPnlUsd: p.netPnlUsd ?? 0 }))
        );

      const wins = closedPositions.filter((p) => (p.netPnlUsd ?? 0) > 0);
      const losses = closedPositions.filter((p) => (p.netPnlUsd ?? 0) < 0);
      const winRatePct = closedPositions.length > 0 ? (wins.length / closedPositions.length) * 100 : null;
      const sumWins = wins.reduce((sum, p) => sum + (p.netPnlUsd ?? 0), 0);
      const sumLosses = Math.abs(losses.reduce((sum, p) => sum + (p.netPnlUsd ?? 0), 0));
      const profitFactor = sumLosses > 0 ? sumWins / sumLosses : null;

      const maxDrawdownPct = calculateMaxDrawdownPct(snapshots.map((s) => s.totalValueUsd));
      const benchmark = await getBenchmarkComparison(strategy.id, strategy.createdAt, valuation.roiPct);

      return {
        strategy,
        currentValueUsd: valuation.totalValueUsd,
        totalPnlUsd: valuation.totalPnlUsd,
        roiPct: valuation.roiPct,
        maxDrawdownPct,
        closedTradeCount: closedPositions.length,
        openPositionCount: openPositions.length,
        winRatePct,
        profitFactor,
        solRoiPct: benchmark.solRoiPct,
      };
    })
  );
}
