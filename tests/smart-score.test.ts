import { describe, expect, it } from "vitest";
import { calculateSmartScore, type SmartScoreInput } from "@/lib/scoring/smart-score";

const STRONG_WALLET: SmartScoreInput = {
  realizedPnlUsd: 48_291,
  unrealizedPnlUsd: 5_000,
  roiPct: 72,
  winRatePct: 68,
  tradeCount: 183,
  avgTradeSizeUsd: 2_300,
  profitConcentrationPct: 14,
  maxDrawdownPct: 14,
  tradingHistoryDays: 420,
  lastActivityDaysAgo: 0.3,
  pnlSeries: Array.from({ length: 30 }, (_, i) => i * 1600 + Math.sin(i) * 200),
};

describe("calculateSmartScore — component weighting", () => {
  it("sums component weights to 100", () => {
    const result = calculateSmartScore(STRONG_WALLET);
    const totalWeight = result.components.reduce((sum, c) => sum + c.weightPct, 0);
    expect(totalWeight).toBe(100);
  });

  it("scores a consistently profitable, low-drawdown, well-sampled wallet highly", () => {
    const result = calculateSmartScore(STRONG_WALLET);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("never produces a score outside [0, 100]", () => {
    const worst: SmartScoreInput = {
      realizedPnlUsd: -10_000,
      unrealizedPnlUsd: -5_000,
      roiPct: -80,
      winRatePct: 5,
      tradeCount: 1,
      avgTradeSizeUsd: 10,
      profitConcentrationPct: 100,
      maxDrawdownPct: 95,
      tradingHistoryDays: 1,
      lastActivityDaysAgo: 400,
      pnlSeries: [0, -1000],
    };
    const result = calculateSmartScore(worst);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("calculateSmartScore — penalties (§10/§11)", () => {
  it("penalizes severe profit concentration (>=90% from one token)", () => {
    const concentrated: SmartScoreInput = { ...STRONG_WALLET, profitConcentrationPct: 94 };
    const diversified: SmartScoreInput = { ...STRONG_WALLET, profitConcentrationPct: 14 };

    const a = calculateSmartScore(concentrated);
    const b = calculateSmartScore(diversified);

    expect(a.score).toBeLessThan(b.score);
    expect(a.penaltiesApplied.some((p) => p.toLowerCase().includes("concentration"))).toBe(true);
  });

  it("penalizes a small trade sample even when other metrics look great", () => {
    const smallSample: SmartScoreInput = { ...STRONG_WALLET, tradeCount: 3 };
    const largeSample: SmartScoreInput = { ...STRONG_WALLET, tradeCount: 183 };

    const a = calculateSmartScore(smallSample);
    const b = calculateSmartScore(largeSample);

    expect(a.score).toBeLessThan(b.score);
  });

  it("penalizes long inactivity", () => {
    const stale: SmartScoreInput = { ...STRONG_WALLET, lastActivityDaysAgo: 90 };
    const active: SmartScoreInput = { ...STRONG_WALLET, lastActivityDaysAgo: 0.3 };

    const a = calculateSmartScore(stale);
    const b = calculateSmartScore(active);

    expect(a.score).toBeLessThan(b.score);
  });

  it("penalizes wallets whose unrealized PnL dwarfs realized PnL (paper gains)", () => {
    const paperGains: SmartScoreInput = { ...STRONG_WALLET, realizedPnlUsd: 1000, unrealizedPnlUsd: 50_000 };
    const realizedGains: SmartScoreInput = { ...STRONG_WALLET, realizedPnlUsd: 48_000, unrealizedPnlUsd: 1000 };

    const a = calculateSmartScore(paperGains);
    const b = calculateSmartScore(realizedGains);

    expect(a.score).toBeLessThan(b.score);
  });

  it("does not fabricate a favorable drawdown score when drawdown is unmeasured, and flags it as a risk", () => {
    const unmeasured: SmartScoreInput = { ...STRONG_WALLET, maxDrawdownPct: null };
    const result = calculateSmartScore(unmeasured);
    const drawdownComponent = result.components.find((c) => c.key === "drawdown")!;
    expect(drawdownComponent.normalizedScore).toBe(50); // neutral, not 100
    expect(result.risks.some((r) => r.toLowerCase().includes("drawdown"))).toBe(true);
  });
});
