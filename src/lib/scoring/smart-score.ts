import type { SmartScoreComponent, SmartScoreResult } from "@/types/domain";

/**
 * WalletRadar Smart Score (§9-13). 0-100, weighted components, each
 * independently normalized before weighting so no single metric (especially
 * ROI) can dominate the ranking.
 *
 * Component bounds below are fixed thresholds derived from the Recommended
 * preset defaults (§6/7) rather than dynamic percentile winsorization against
 * a candidate pool — the manual single-wallet analyzer (Phase 1B) has no
 * pool to winsorize against. Batch discovery/scoring (Phase 1D-1F) should
 * layer pool-relative winsorization on top of these same component scores.
 */

export interface SmartScoreInput {
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  roiPct: number | null;
  winRatePct: number | null;
  tradeCount: number;
  avgTradeSizeUsd: number | null;
  profitConcentrationPct: number | null; // 0-100, share of total profit from the single best token
  maxDrawdownPct: number | null; // 0-100 magnitude; null if it couldn't be estimated
  tradingHistoryDays: number | null;
  lastActivityDaysAgo: number | null;
  /** Cumulative realized-PnL curve, ascending time order, used for consistency. */
  pnlSeries: number[];
}

const WEIGHTS: Record<SmartScoreComponent["key"], { label: string; weightPct: number }> = {
  consistency: { label: "Consistency", weightPct: 20 },
  riskAdjustedProfitability: { label: "Risk-Adjusted Profitability", weightPct: 20 },
  realizedPnlQuality: { label: "Realized PnL Quality", weightPct: 15 },
  winRateQuality: { label: "Win Rate Quality", weightPct: 15 },
  drawdown: { label: "Drawdown", weightPct: 10 },
  sampleSize: { label: "Trade Sample Size", weightPct: 10 },
  tradingHistory: { label: "Trading History", weightPct: 5 },
  recentActivity: { label: "Recent Activity", weightPct: 5 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Linearly maps [min, max] -> [0, 100], clipped at both ends. */
function scoreFromRange(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function scoreSampleSize(tradeCount: number): number {
  // Log-scaled so the marginal value of each extra trade shrinks — 150 trades saturates the score.
  const saturationTrades = 150;
  return scoreFromRange(Math.log10(tradeCount + 1), 0, Math.log10(saturationTrades + 1));
}

function scoreTradingHistory(tradingHistoryDays: number | null): number {
  if (tradingHistoryDays === null) return 0;
  return scoreFromRange(tradingHistoryDays, 0, 365);
}

function scoreRecentActivity(lastActivityDaysAgo: number | null): number {
  if (lastActivityDaysAgo === null) return 0;
  return 100 - scoreFromRange(lastActivityDaysAgo, 0, 30);
}

function scoreWinRateQuality(winRatePct: number | null): number {
  if (winRatePct === null) return 50;
  return scoreFromRange(winRatePct, 30, 80);
}

function scoreRealizedPnlQuality(realizedPnlUsd: number | null, unrealizedPnlUsd: number | null): number {
  const realized = realizedPnlUsd ?? 0;
  const unrealized = unrealizedPnlUsd ?? 0;
  const total = realized + unrealized;
  if (total <= 0) return 0;
  return clamp((realized / total) * 100, 0, 100);
}

function scoreRiskAdjustedProfitability(roiPct: number | null, maxDrawdownPct: number | null): number {
  if (roiPct === null || roiPct <= 0) return 0;
  const drawdown = Math.max(maxDrawdownPct ?? 20, 5); // assume a moderate drawdown if unmeasured, don't reward the unknown
  const ratio = roiPct / drawdown;
  return scoreFromRange(ratio, 0, 5);
}

function scoreDrawdown(maxDrawdownPct: number | null): number {
  if (maxDrawdownPct === null) return 50; // neutral — unmeasured, not "good"
  return 100 - scoreFromRange(maxDrawdownPct, 0, 60);
}

function scoreConsistency(pnlSeries: number[]): number {
  if (pnlSeries.length < 3) return 50; // not enough points — neutral, flagged as a risk by the caller
  const deltas: number[] = [];
  for (let i = 1; i < pnlSeries.length; i++) deltas.push(pnlSeries[i] - pnlSeries[i - 1]);

  const mean = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
  const variance = deltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / deltas.length;
  const stddev = Math.sqrt(variance);
  const meanAbs = deltas.reduce((sum, d) => sum + Math.abs(d), 0) / deltas.length;

  if (meanAbs === 0) return 50;
  const coefficientOfVariation = stddev / meanAbs;
  return 100 - scoreFromRange(coefficientOfVariation, 0, 3);
}

export function calculateSmartScore(input: SmartScoreInput): SmartScoreResult {
  const raw: Record<SmartScoreComponent["key"], number> = {
    consistency: scoreConsistency(input.pnlSeries),
    riskAdjustedProfitability: scoreRiskAdjustedProfitability(input.roiPct, input.maxDrawdownPct),
    realizedPnlQuality: scoreRealizedPnlQuality(input.realizedPnlUsd, input.unrealizedPnlUsd),
    winRateQuality: scoreWinRateQuality(input.winRatePct),
    drawdown: scoreDrawdown(input.maxDrawdownPct),
    sampleSize: scoreSampleSize(input.tradeCount),
    tradingHistory: scoreTradingHistory(input.tradingHistoryDays),
    recentActivity: scoreRecentActivity(input.lastActivityDaysAgo),
  };

  const components: SmartScoreComponent[] = (
    Object.keys(WEIGHTS) as SmartScoreComponent["key"][]
  ).map((key) => ({
    key,
    label: WEIGHTS[key].label,
    weightPct: WEIGHTS[key].weightPct,
    normalizedScore: Math.round(raw[key] * 10) / 10,
  }));

  const weightedScore = components.reduce(
    (sum, c) => sum + (c.normalizedScore * c.weightPct) / 100,
    0
  );

  // --- Penalties (§10), multiplicative so they compound rather than one masking another ---
  const penaltiesApplied: string[] = [];
  let penaltyFactor = 1;

  if (input.profitConcentrationPct !== null) {
    if (input.profitConcentrationPct >= 90) {
      penaltyFactor *= 0.6;
      penaltiesApplied.push(
        `Severe profit concentration: ${input.profitConcentrationPct.toFixed(0)}% of profit from one token`
      );
    } else if (input.profitConcentrationPct >= 70) {
      penaltyFactor *= 0.8;
      penaltiesApplied.push(
        `High profit concentration: ${input.profitConcentrationPct.toFixed(0)}% of profit from one token`
      );
    }
  }

  const realized = input.realizedPnlUsd ?? 0;
  const unrealized = input.unrealizedPnlUsd ?? 0;
  if (realized > 0 && unrealized > realized * 3) {
    penaltyFactor *= 0.85;
    penaltiesApplied.push("Unrealized PnL far exceeds realized PnL (mostly paper gains)");
  }

  if (input.tradeCount < 50) {
    const factor = clamp(input.tradeCount / 50, 0.3, 1);
    penaltyFactor *= factor;
    penaltiesApplied.push(`Small sample size: only ${input.tradeCount} trades`);
  }

  if (input.lastActivityDaysAgo !== null && input.lastActivityDaysAgo > 30) {
    penaltyFactor *= 0.7;
    penaltiesApplied.push(`Inactive for ${Math.round(input.lastActivityDaysAgo)} days`);
  }

  const score = Math.round(clamp(weightedScore * penaltyFactor, 0, 100));

  const strengths = components
    .filter((c) => c.normalizedScore >= 70)
    .map((c) => `Strong ${c.label.toLowerCase()} (${c.normalizedScore.toFixed(0)}/100)`);

  const risks = [
    ...penaltiesApplied,
    ...components
      .filter((c) => c.normalizedScore < 40)
      .map((c) => `Weak ${c.label.toLowerCase()} (${c.normalizedScore.toFixed(0)}/100)`),
  ];

  if (input.maxDrawdownPct === null) {
    risks.push("Drawdown could not be measured from available data");
  }

  return { score, components, strengths, risks, penaltiesApplied };
}
