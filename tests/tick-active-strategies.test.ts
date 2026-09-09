import { describe, expect, it, vi } from "vitest";
import { selectActiveStrategies, runTicksForStrategies } from "@/lib/demo/tick-orchestration";
import type { DemoStrategy } from "@/lib/demo/types";
import type { DemoTickResult } from "@/lib/demo/run-tick";

function strategy(overrides: Partial<DemoStrategy>): DemoStrategy {
  return {
    id: "s1",
    name: "Test Strategy",
    status: "ACTIVE",
    startingCapitalUsd: 1000,
    minSmartScore: 50,
    minWalletsRequired: 2,
    signalWindowMinutes: 180,
    virtualBuySizeUsd: 100,
    maxOpenPositions: 10,
    maxAllocationPctPerToken: 10,
    stopLossPct: null,
    takeProfitPct: null,
    maxPositionAgeHours: null,
    simulatedSlippagePct: 0.5,
    feePct: 0,
    minTokenLiquidityUsd: null,
    minMarketCapUsd: null,
    maxMarketCapUsd: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function tickResult(overrides: Partial<DemoTickResult> = {}): DemoTickResult {
  return {
    strategyId: "s1",
    signalsConsidered: 0,
    positionsOpened: 0,
    positionsClosed: 0,
    priceCallsMade: 0,
    skippedSignals: [],
    outcomeObservationsRecorded: 0,
    outcomePriceCallsMade: 0,
    errors: [],
    ...overrides,
  };
}

describe("selectActiveStrategies", () => {
  it("keeps only ACTIVE strategies, excluding PAUSED ones", () => {
    const strategies = [
      strategy({ id: "a", status: "ACTIVE" }),
      strategy({ id: "b", status: "PAUSED" }),
      strategy({ id: "c", status: "ACTIVE" }),
    ];
    expect(selectActiveStrategies(strategies).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("returns an empty array when there are no strategies at all", () => {
    expect(selectActiveStrategies([])).toEqual([]);
  });

  it("returns an empty array when every strategy is paused", () => {
    const strategies = [strategy({ id: "a", status: "PAUSED" }), strategy({ id: "b", status: "PAUSED" })];
    expect(selectActiveStrategies(strategies)).toEqual([]);
  });
});

describe("runTicksForStrategies — one strategy failure isolation", () => {
  it("ticks only ACTIVE strategies, skipping PAUSED ones entirely (never calls tickFn for them)", async () => {
    const strategies = [strategy({ id: "a", status: "ACTIVE" }), strategy({ id: "b", status: "PAUSED" })];
    const tickFn = vi.fn(async (strategyId: string) => tickResult({ strategyId }));

    const result = await runTicksForStrategies(strategies, tickFn);

    expect(tickFn).toHaveBeenCalledTimes(1);
    expect(tickFn).toHaveBeenCalledWith("a");
    expect(result.strategiesTicked).toBe(1);
  });

  it("one strategy throwing does not stop the rest, and is recorded as a failure", async () => {
    const strategies = [
      strategy({ id: "a", name: "Alpha" }),
      strategy({ id: "b", name: "Bravo" }),
      strategy({ id: "c", name: "Charlie" }),
    ];
    const tickFn = vi.fn(async (strategyId: string) => {
      if (strategyId === "b") throw new Error("Birdeye unreachable");
      return tickResult({ strategyId });
    });

    const result = await runTicksForStrategies(strategies, tickFn);

    expect(tickFn).toHaveBeenCalledTimes(3); // a, b, c all attempted — b failing didn't stop c
    expect(result.strategiesTicked).toBe(3);
    expect(result.strategiesFailed).toBe(1);
    expect(result.outcomes.find((o) => o.strategyId === "a")?.error).toBeUndefined();
    expect(result.outcomes.find((o) => o.strategyId === "b")?.error).toBe("Birdeye unreachable");
    expect(result.outcomes.find((o) => o.strategyId === "c")?.error).toBeUndefined();
    expect(result.outcomes.find((o) => o.strategyId === "a")?.result).toBeDefined();
    expect(result.outcomes.find((o) => o.strategyId === "c")?.result).toBeDefined();
  });

  it("records a lockSkipped tick result as a normal outcome, not a failure", async () => {
    const strategies = [strategy({ id: "a" })];
    const tickFn = vi.fn(async (strategyId: string) => tickResult({ strategyId, lockSkipped: true }));

    const result = await runTicksForStrategies(strategies, tickFn);

    expect(result.strategiesFailed).toBe(0);
    expect(result.outcomes[0].result?.lockSkipped).toBe(true);
    expect(result.outcomes[0].error).toBeUndefined();
  });

  it("processes strategies sequentially, never overlapping (no concurrent tickFn calls in flight)", async () => {
    const strategies = [strategy({ id: "a" }), strategy({ id: "b" })];
    let inFlight = 0;
    let maxConcurrent = 0;
    const tickFn = vi.fn(async (strategyId: string) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return tickResult({ strategyId });
    });

    await runTicksForStrategies(strategies, tickFn);

    expect(maxConcurrent).toBe(1);
  });

  it("returns zero ticked/failed for an empty strategy list", async () => {
    const tickFn = vi.fn();
    const result = await runTicksForStrategies([], tickFn);
    expect(result).toEqual({ strategiesTicked: 0, strategiesFailed: 0, outcomes: [] });
    expect(tickFn).not.toHaveBeenCalled();
  });
});
