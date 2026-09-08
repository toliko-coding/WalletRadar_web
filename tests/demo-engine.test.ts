import { describe, expect, it } from "vitest";
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
} from "@/lib/demo/engine";

describe("simulateFill — anti-look-ahead / no-free-lunch (§30-32)", () => {
  it("a BUY always pays more than the reference price", () => {
    const fill = simulateFill(100, 0.5, "BUY");
    expect(fill.executionPrice).toBeGreaterThan(100);
    expect(fill.executionPrice).toBeCloseTo(100.5);
  });

  it("a SELL always receives less than the reference price", () => {
    const fill = simulateFill(100, 0.5, "SELL");
    expect(fill.executionPrice).toBeLessThan(100);
    expect(fill.executionPrice).toBeCloseTo(99.5);
  });

  it("zero slippage fills exactly at the reference price (explicit config, not a hidden default)", () => {
    expect(simulateFill(100, 0, "BUY").executionPrice).toBe(100);
    expect(simulateFill(100, 0, "SELL").executionPrice).toBe(100);
  });

  it("rejects a non-positive reference price rather than silently producing garbage", () => {
    expect(() => simulateFill(0, 0.5, "BUY")).toThrow();
    expect(() => simulateFill(-5, 0.5, "BUY")).toThrow();
  });

  it("rejects negative slippage (would make fills systematically favorable, the opposite of realistic)", () => {
    expect(() => simulateFill(100, -1, "BUY")).toThrow();
  });
});

describe("computePositionQuantity", () => {
  it("divides position size by execution price", () => {
    expect(computePositionQuantity(100, 4)).toBe(25);
  });

  it("rejects a non-positive execution price", () => {
    expect(() => computePositionQuantity(100, 0)).toThrow();
  });
});

describe("calculateFeeUsd", () => {
  it("computes a flat percentage fee", () => {
    expect(calculateFeeUsd(1000, 1)).toBe(10);
  });

  it("never returns a negative fee for negative inputs", () => {
    expect(calculateFeeUsd(-100, 1)).toBe(0);
    expect(calculateFeeUsd(100, -1)).toBe(0);
  });
});

describe("isSignalEligible — no retroactive fills (§39)", () => {
  it("accepts a signal detected after the strategy was created", () => {
    expect(isSignalEligible("2026-08-11T15:00:00Z", "2026-08-11T14:00:00Z")).toBe(true);
  });

  it("rejects a signal detected before the strategy was created", () => {
    expect(isSignalEligible("2026-08-11T13:00:00Z", "2026-08-11T14:00:00Z")).toBe(false);
  });

  it("rejects a signal detected at the exact instant of strategy creation", () => {
    expect(isSignalEligible("2026-08-11T14:00:00Z", "2026-08-11T14:00:00Z")).toBe(false);
  });
});

describe("canOpenNewPosition", () => {
  it("allows opening below the cap", () => {
    expect(canOpenNewPosition(3, 10)).toBe(true);
  });

  it("blocks opening at or above the cap", () => {
    expect(canOpenNewPosition(10, 10)).toBe(false);
    expect(canOpenNewPosition(11, 10)).toBe(false);
  });
});

describe("exceedsMaxAllocation", () => {
  it("allows a position within the per-token allocation cap", () => {
    // $500 into a $10,000 portfolio = 5%, under a 10% cap.
    expect(exceedsMaxAllocation(0, 500, 10_000, 10)).toBe(false);
  });

  it("blocks a position that would breach the per-token allocation cap", () => {
    // $500 existing + $600 new = $1,100 / $10,000 = 11%, over a 10% cap.
    expect(exceedsMaxAllocation(500, 600, 10_000, 10)).toBe(true);
  });

  it("never blocks the very first position when portfolio value is zero/unknown", () => {
    expect(exceedsMaxAllocation(0, 100, 0, 10)).toBe(false);
  });
});

describe("evaluateExit", () => {
  const base = {
    entryPrice: 100,
    stopLossPct: 10,
    takeProfitPct: 20,
    maxPositionAgeHours: 24,
    entryTime: "2026-08-11T12:00:00Z",
  };

  it("triggers STOP_LOSS when price drops to or below the stop level", () => {
    const result = evaluateExit(base, 89, new Date("2026-08-11T13:00:00Z"));
    expect(result?.rule).toBe("STOP_LOSS");
  });

  it("triggers TAKE_PROFIT when price rises to or above the target level", () => {
    const result = evaluateExit(base, 121, new Date("2026-08-11T13:00:00Z"));
    expect(result?.rule).toBe("TAKE_PROFIT");
  });

  it("triggers MAX_HOLDING_PERIOD once the position is old enough, even with a flat price", () => {
    const result = evaluateExit(base, 100, new Date("2026-08-12T13:00:00Z")); // 25h later
    expect(result?.rule).toBe("MAX_HOLDING_PERIOD");
  });

  it("returns null when no exit condition is met", () => {
    const result = evaluateExit(base, 105, new Date("2026-08-11T13:00:00Z"));
    expect(result).toBeNull();
  });

  it("prioritizes STOP_LOSS over MAX_HOLDING_PERIOD when both would fire", () => {
    const result = evaluateExit(base, 85, new Date("2026-08-12T13:00:00Z"));
    expect(result?.rule).toBe("STOP_LOSS");
  });

  it("ignores a null exit rule instead of treating it as an immediate trigger", () => {
    const noRules = { ...base, stopLossPct: null, takeProfitPct: null, maxPositionAgeHours: null };
    expect(evaluateExit(noRules, 1, new Date("2099-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("calculateTradePnl", () => {
  it("computes gross and net PnL for a winning trade", () => {
    const result = calculateTradePnl(100, 10, 120, 5);
    expect(result.grossPnlUsd).toBeCloseTo(200); // (120-100)*10
    expect(result.netPnlUsd).toBeCloseTo(195);
  });

  it("computes gross and net PnL for a losing trade", () => {
    const result = calculateTradePnl(100, 10, 80, 5);
    expect(result.grossPnlUsd).toBeCloseTo(-200);
    expect(result.netPnlUsd).toBeCloseTo(-205);
  });
});

describe("calculatePortfolioValuation", () => {
  it("sums cash + open position value, and realized + unrealized PnL", () => {
    const result = calculatePortfolioValuation(
      8_000,
      10_000,
      [{ entryPrice: 10, quantity: 100, currentPrice: 12 }], // $1,200 value, +$200 unrealized
      [{ netPnlUsd: 150 }]
    );
    expect(result.openPositionValueUsd).toBeCloseTo(1_200);
    expect(result.totalValueUsd).toBeCloseTo(9_200);
    expect(result.unrealizedPnlUsd).toBeCloseTo(200);
    expect(result.realizedPnlUsd).toBeCloseTo(150);
    expect(result.totalPnlUsd).toBeCloseTo(350);
    expect(result.roiPct).toBeCloseTo(3.5);
  });

  it("treats a position with no available current price as $0 exposure rather than guessing", () => {
    const result = calculatePortfolioValuation(
      9_000,
      10_000,
      [{ entryPrice: 10, quantity: 100, currentPrice: null }],
      []
    );
    expect(result.openPositionValueUsd).toBe(0);
    expect(result.unrealizedPnlUsd).toBe(0);
  });

  it("returns 0 ROI rather than dividing by zero when starting capital is 0", () => {
    const result = calculatePortfolioValuation(0, 0, [], []);
    expect(result.roiPct).toBe(0);
  });
});

describe("passesTokenRiskFilters (§43)", () => {
  const noFilters = { minTokenLiquidityUsd: null, minMarketCapUsd: null, maxMarketCapUsd: null };

  it("passes anything when no filters are configured", () => {
    expect(passesTokenRiskFilters({ liquidityUsd: null, marketCapUsd: null }, noFilters)).toBe(true);
  });

  it("passes a token meeting the minimum liquidity requirement", () => {
    const filters = { ...noFilters, minTokenLiquidityUsd: 50_000 };
    expect(passesTokenRiskFilters({ liquidityUsd: 100_000, marketCapUsd: null }, filters)).toBe(true);
  });

  it("fails a token below the minimum liquidity requirement", () => {
    const filters = { ...noFilters, minTokenLiquidityUsd: 50_000 };
    expect(passesTokenRiskFilters({ liquidityUsd: 10_000, marketCapUsd: null }, filters)).toBe(false);
  });

  it("fails a token with unknown liquidity when a minimum is configured — never assumes it's fine", () => {
    const filters = { ...noFilters, minTokenLiquidityUsd: 50_000 };
    expect(passesTokenRiskFilters({ liquidityUsd: null, marketCapUsd: null }, filters)).toBe(false);
  });

  it("enforces both a minimum and maximum market cap band", () => {
    const filters = { ...noFilters, minMarketCapUsd: 1_000_000, maxMarketCapUsd: 50_000_000 };
    expect(passesTokenRiskFilters({ liquidityUsd: null, marketCapUsd: 10_000_000 }, filters)).toBe(true);
    expect(passesTokenRiskFilters({ liquidityUsd: null, marketCapUsd: 500_000 }, filters)).toBe(false); // too small
    expect(passesTokenRiskFilters({ liquidityUsd: null, marketCapUsd: 60_000_000 }, filters)).toBe(false); // too large
  });

  it("fails a token with unknown market cap when a max cap is configured", () => {
    const filters = { ...noFilters, maxMarketCapUsd: 50_000_000 };
    expect(passesTokenRiskFilters({ liquidityUsd: null, marketCapUsd: null }, filters)).toBe(false);
  });
});
