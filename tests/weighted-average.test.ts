import { describe, expect, it } from "vitest";
import { computeWeightedAverageCostBasis } from "@/lib/costbasis/weighted-average";

describe("computeWeightedAverageCostBasis", () => {
  it("computes the textbook weighted-average example from the spec (§19)", () => {
    // BUY 100 @ $1, BUY 100 @ $2 -> average $1.50, then SELL 50.
    const result = computeWeightedAverageCostBasis([
      { type: "BUY", amount: 100, usdValue: 100, timestamp: "2026-01-01T00:00:00Z" },
      { type: "BUY", amount: 100, usdValue: 200, timestamp: "2026-01-02T00:00:00Z" },
      { type: "SELL", amount: 50, usdValue: 100, timestamp: "2026-01-03T00:00:00Z" },
    ]);

    expect(result.sells).toHaveLength(1);
    expect(result.sells[0].costOfSoldUsd).toBeCloseTo(75); // 50 * $1.50
    expect(result.sells[0].realizedPnlUsd).toBeCloseTo(25); // $100 proceeds - $75 cost
    expect(result.remainingQuantity).toBeCloseTo(150);
    expect(result.remainingCostBasisUsd).toBeCloseTo(225); // $300 - $75
    expect(result.averageEntryPrice).toBeCloseTo(1.5);
  });

  it("updates the running average after a sell, for a subsequent buy", () => {
    const result = computeWeightedAverageCostBasis([
      { type: "BUY", amount: 10, usdValue: 100, timestamp: "2026-01-01T00:00:00Z" }, // $10/ea
      { type: "SELL", amount: 5, usdValue: 75, timestamp: "2026-01-02T00:00:00Z" }, // sells 5 @ $15
      { type: "BUY", amount: 5, usdValue: 100, timestamp: "2026-01-03T00:00:00Z" }, // buys 5 @ $20
    ]);

    // After the sell: 5 remaining @ $10 cost basis = $50.
    // After the buy: (50 + 100) / (5 + 5) = $15 average.
    expect(result.averageEntryPrice).toBeCloseTo(15);
    expect(result.remainingQuantity).toBeCloseTo(10);
  });

  it("flags a sell that exceeds tracked buy history instead of fabricating a negative position", () => {
    const result = computeWeightedAverageCostBasis([
      { type: "BUY", amount: 10, usdValue: 100, timestamp: "2026-01-01T00:00:00Z" },
      { type: "SELL", amount: 25, usdValue: 500, timestamp: "2026-01-02T00:00:00Z" },
    ]);

    expect(result.sells[0].costBasisComplete).toBe(false);
    expect(result.remainingQuantity).toBe(0);
    expect(result.remainingCostBasisUsd).toBe(0);
  });

  it("ignores zero/negative amount events instead of corrupting the running average", () => {
    const result = computeWeightedAverageCostBasis([
      { type: "BUY", amount: 10, usdValue: 100, timestamp: "2026-01-01T00:00:00Z" },
      { type: "BUY", amount: 0, usdValue: 0, timestamp: "2026-01-02T00:00:00Z" },
      { type: "SELL", amount: -5, usdValue: 50, timestamp: "2026-01-03T00:00:00Z" },
    ]);

    expect(result.remainingQuantity).toBe(10);
    expect(result.sells).toHaveLength(0);
  });

  it("returns a null average entry price for an empty/fully-sold position rather than 0", () => {
    const result = computeWeightedAverageCostBasis([
      { type: "BUY", amount: 10, usdValue: 100, timestamp: "2026-01-01T00:00:00Z" },
      { type: "SELL", amount: 10, usdValue: 150, timestamp: "2026-01-02T00:00:00Z" },
    ]);

    expect(result.remainingQuantity).toBe(0);
    expect(result.averageEntryPrice).toBeNull();
  });

  it("sorts out-of-order events chronologically before computing", () => {
    const inOrder = computeWeightedAverageCostBasis([
      { type: "BUY", amount: 10, usdValue: 100, timestamp: "2026-01-01T00:00:00Z" },
      { type: "SELL", amount: 5, usdValue: 75, timestamp: "2026-01-02T00:00:00Z" },
    ]);
    const reversed = computeWeightedAverageCostBasis([
      { type: "SELL", amount: 5, usdValue: 75, timestamp: "2026-01-02T00:00:00Z" },
      { type: "BUY", amount: 10, usdValue: 100, timestamp: "2026-01-01T00:00:00Z" },
    ]);
    expect(reversed).toEqual(inOrder);
  });
});
