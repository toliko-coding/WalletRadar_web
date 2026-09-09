import { describe, expect, it } from "vitest";
import {
  resolveHorizonOutcome,
  resolveHorizonReturn,
  computeHorizonCoverage,
  computeHeadlineStats,
  classifySampleConfidence,
  hasReturnOutlier,
  HORIZON_DEFINITIONS,
  type PriceObservation,
  type ResolvedReturn,
} from "@/lib/validation/horizons";
import {
  findMatchingEvent,
  mergeEventWallets,
  newEventFields,
  type ExistingEventSummary,
  type NewDetection,
  type EventWalletEntry,
} from "@/lib/validation/event-matching";

function obs(minutesSinceEvaluation: number, priceUsd: number): PriceObservation {
  return { minutesSinceEvaluation, priceUsd };
}

function horizon(key: string) {
  const h = HORIZON_DEFINITIONS.find((d) => d.key === key);
  if (!h) throw new Error(`unknown horizon ${key}`);
  return h;
}

describe("resolveHorizonOutcome — §E worked example (detection 14:00, observations +6/+17/+63/+251m)", () => {
  const observations = [obs(6, 1), obs(17, 1), obs(63, 1), obs(251, 1)];

  it("5m resolves on-time at +6m", () => {
    const result = resolveHorizonOutcome(observations, horizon("5m"));
    expect(result.status).toBe("RESOLVED_ON_TIME");
    expect(result.actualMinutesElapsed).toBe(6);
  });

  it("15m resolves on-time at +17m (the +6m observation falls outside this window entirely)", () => {
    const result = resolveHorizonOutcome(observations, horizon("15m"));
    expect(result.status).toBe("RESOLVED_ON_TIME");
    expect(result.actualMinutesElapsed).toBe(17);
  });

  it("1h resolves on-time at +63m", () => {
    const result = resolveHorizonOutcome(observations, horizon("1h"));
    expect(result.status).toBe("RESOLVED_ON_TIME");
    expect(result.actualMinutesElapsed).toBe(63);
  });

  it("4h resolves on-time at +251m", () => {
    const result = resolveHorizonOutcome(observations, horizon("4h"));
    expect(result.status).toBe("RESOLVED_ON_TIME");
    expect(result.actualMinutesElapsed).toBe(251);
  });

  it("24h is UNAVAILABLE — nothing observed that far out", () => {
    const result = resolveHorizonOutcome(observations, horizon("24h"));
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.observation).toBeNull();
  });
});

describe("resolveHorizonOutcome — early-approximation fallback and anti-optimism-bias rule", () => {
  it("falls back to RESOLVED_EARLY_APPROX when only a before-target observation exists in window", () => {
    // Only +50m in [45,90] for the 1h horizon — nothing at or after 60m.
    const result = resolveHorizonOutcome([obs(50, 1)], horizon("1h"));
    expect(result.status).toBe("RESOLVED_EARLY_APPROX");
    expect(result.actualMinutesElapsed).toBe(50);
  });

  it("prefers an at-or-after observation over a numerically-closer before-target one", () => {
    // +58m is closer to the 60m target than +75m, but must NOT win — an
    // at-or-after observation is always preferred to avoid optimistic bias.
    const result = resolveHorizonOutcome([obs(58, 100), obs(75, 200)], horizon("1h"));
    expect(result.status).toBe("RESOLVED_ON_TIME");
    expect(result.actualMinutesElapsed).toBe(75);
  });

  it("among multiple at-or-after observations, picks the earliest (minimizes overshoot)", () => {
    const result = resolveHorizonOutcome([obs(65, 1), obs(61, 2), obs(89, 3)], horizon("1h"));
    expect(result.status).toBe("RESOLVED_ON_TIME");
    expect(result.actualMinutesElapsed).toBe(61);
  });

  it("excludes observations outside the acceptable window even if numerically nearest", () => {
    // +200m is far outside 1h's [45,90] window and must not be used at all.
    const result = resolveHorizonOutcome([obs(200, 1)], horizon("1h"));
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("boundary minutes are inclusive at both ends of the window", () => {
    expect(resolveHorizonOutcome([obs(45, 1)], horizon("1h")).status).toBe("RESOLVED_EARLY_APPROX");
    expect(resolveHorizonOutcome([obs(90, 1)], horizon("1h")).status).toBe("RESOLVED_ON_TIME");
  });
});

describe("resolveHorizonReturn — baseline + forward horizon composition", () => {
  it("computes a positive return when both baseline and forward observations resolve on-time", () => {
    const observations = [obs(1, 100), obs(65, 150)];
    const result = resolveHorizonReturn(observations, horizon("1h"));
    expect(result.status).toBe("RESOLVED_ON_TIME");
    expect(result.returnPct).toBeCloseTo(50);
  });

  it("is UNAVAILABLE when the baseline price was never captured, even if a forward price exists", () => {
    const observations = [obs(65, 150)]; // nothing in [0,5] for the baseline
    const result = resolveHorizonReturn(observations, horizon("1h"));
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.returnPct).toBeNull();
  });

  it("is UNAVAILABLE when the forward horizon has no qualifying observation", () => {
    const observations = [obs(1, 100)];
    const result = resolveHorizonReturn(observations, horizon("1h"));
    expect(result.status).toBe("UNAVAILABLE");
  });
});

describe("computeHorizonCoverage and computeHeadlineStats — RESOLVED_EARLY_APPROX must never enter headline stats", () => {
  function resolved(status: ResolvedReturn["status"], returnPct: number | null): ResolvedReturn {
    return { status, returnPct, baselinePriceUsd: 1, outcomePriceUsd: 1, actualMinutesElapsed: 60 };
  }

  it("counts on-time/early/unavailable separately in coverage", () => {
    const results = [
      resolved("RESOLVED_ON_TIME", 10),
      resolved("RESOLVED_ON_TIME", -5),
      resolved("RESOLVED_EARLY_APPROX", 999), // deliberately huge to prove it's excluded below
      resolved("UNAVAILABLE", null),
    ];
    const coverage = computeHorizonCoverage(results);
    expect(coverage).toEqual({ onTimeCount: 2, earlyOnlyCount: 1, unavailableCount: 1 });
  });

  it("headline stats (n, mean, median, win rate) are computed from RESOLVED_ON_TIME rows only", () => {
    const onTimeOnly = [resolved("RESOLVED_ON_TIME", 10), resolved("RESOLVED_ON_TIME", -5), resolved("RESOLVED_ON_TIME", 20)];
    // Simulate a caller correctly filtering before calling computeHeadlineStats.
    const stats = computeHeadlineStats(onTimeOnly);
    expect(stats.n).toBe(3);
    expect(stats.positiveCount).toBe(2);
    expect(stats.positivePct).toBeCloseTo((2 / 3) * 100);
    expect(stats.meanReturnPct).toBeCloseTo((10 - 5 + 20) / 3);
    expect(stats.medianReturnPct).toBe(10);
  });

  it("regression: a RESOLVED_EARLY_APPROX row passed in by mistake is excluded from n/mean/median/win-rate", () => {
    const mixed = [
      resolved("RESOLVED_ON_TIME", 10),
      resolved("RESOLVED_ON_TIME", 20),
      resolved("RESOLVED_EARLY_APPROX", 999999), // must not skew mean/median/n if this leaks in
    ];
    const stats = computeHeadlineStats(mixed);
    expect(stats.n).toBe(2);
    expect(stats.meanReturnPct).toBeCloseTo(15);
    expect(stats.medianReturnPct).toBeCloseTo(15);
  });

  it("returns a null/zero-confidence result for an empty on-time sample", () => {
    const stats = computeHeadlineStats([]);
    expect(stats.n).toBe(0);
    expect(stats.meanReturnPct).toBeNull();
    expect(stats.medianReturnPct).toBeNull();
    expect(stats.confidence).toBe("insufficient");
  });
});

describe("classifySampleConfidence", () => {
  it.each([
    [0, "insufficient"],
    [9, "insufficient"],
    [10, "low"],
    [29, "low"],
    [30, "moderate"],
    [99, "moderate"],
    [100, "strong"],
    [500, "strong"],
  ] as const)("n=%i -> %s", (n, expected) => {
    expect(classifySampleConfidence(n)).toBe(expected);
  });
});

describe("hasReturnOutlier", () => {
  it("flags a single extreme meme-token return dominating a small sample", () => {
    expect(hasReturnOutlier([5, 8, 500], 6.5, 5)).toBe(true);
  });

  it("does not flag a sample with no extreme values", () => {
    expect(hasReturnOutlier([5, 8, 12], 8, 5)).toBe(false);
  });

  it("does not attempt the ratio heuristic when the median is ~0 (degenerate case)", () => {
    expect(hasReturnOutlier([-50, 0, 50], 0, 5)).toBe(false);
  });

  it("never flags fewer than 2 returns", () => {
    expect(hasReturnOutlier([500], 500, 5)).toBe(false);
  });
});

describe("findMatchingEvent / mergeEventWallets — event identity & dedup (§B)", () => {
  const walletA: EventWalletEntry = { walletAddress: "WA", smartScore: 50, usdValue: 100, occurredAt: "2026-09-08T14:00:00Z" };
  const walletB: EventWalletEntry = { walletAddress: "WB", smartScore: 30, usdValue: 200, occurredAt: "2026-09-08T14:05:00Z" };

  function existing(overrides: Partial<ExistingEventSummary> = {}): ExistingEventSummary {
    return {
      id: "event-1",
      tokenMint: "TokenMint1111111111111111111111111111111",
      signalTime: "2026-09-08T14:00:00Z",
      triggeringWallets: [walletA],
      ...overrides,
    };
  }

  it("matches a new detection on the same token within tolerance", () => {
    const detection: NewDetection = {
      tokenMint: "TokenMint1111111111111111111111111111111",
      signalTime: "2026-09-08T14:30:00Z", // 30 min later, within 60min tolerance
      wallets: [walletA, walletB],
    };
    const match = findMatchingEvent([existing()], detection);
    expect(match?.id).toBe("event-1");
  });

  it("does not match a detection on a different token", () => {
    const detection: NewDetection = {
      tokenMint: "DifferentMint222222222222222222222222222",
      signalTime: "2026-09-08T14:10:00Z",
      wallets: [walletA],
    };
    expect(findMatchingEvent([existing()], detection)).toBeNull();
  });

  it("does not match a detection outside the tolerance window", () => {
    const detection: NewDetection = {
      tokenMint: "TokenMint1111111111111111111111111111111",
      signalTime: "2026-09-08T16:00:00Z", // 120 min later, outside 60min tolerance
      wallets: [walletA],
    };
    expect(findMatchingEvent([existing()], detection)).toBeNull();
  });

  it("breaks ties between multiple in-tolerance candidates by closest signalTime", () => {
    const near = existing({ id: "near", signalTime: "2026-09-08T14:20:00Z" });
    const far = existing({ id: "far", signalTime: "2026-09-08T13:40:00Z" });
    const detection: NewDetection = {
      tokenMint: "TokenMint1111111111111111111111111111111",
      signalTime: "2026-09-08T14:25:00Z",
      wallets: [walletA],
    };
    const match = findMatchingEvent([near, far], detection);
    expect(match?.id).toBe("near");
  });

  it("merges wallets as a union, keeping each wallet's earliest occurredAt", () => {
    const laterWalletA: EventWalletEntry = { ...walletA, occurredAt: "2026-09-08T15:00:00Z" }; // later than existing's 14:00
    const detection: NewDetection = {
      tokenMint: "TokenMint1111111111111111111111111111111",
      signalTime: "2026-09-08T14:30:00Z",
      wallets: [laterWalletA, walletB],
    };
    const merged = mergeEventWallets(existing(), detection);
    expect(merged.walletCount).toBe(2);
    const mergedA = merged.triggeringWallets.find((w) => w.walletAddress === "WA");
    expect(mergedA?.occurredAt).toBe("2026-09-08T14:00:00Z"); // kept the earlier one, not overwritten by the later re-detection
  });

  it("moves signalTime to the earlier of the two on merge", () => {
    const detection: NewDetection = {
      tokenMint: "TokenMint1111111111111111111111111111111",
      signalTime: "2026-09-08T13:45:00Z", // earlier than existing's 14:00
      wallets: [walletB],
    };
    const merged = mergeEventWallets(existing(), detection);
    expect(merged.signalTime).toBe("2026-09-08T13:45:00.000Z");
  });

  it("recomputes min/max/avg smart score from the merged union", () => {
    const detection: NewDetection = {
      tokenMint: "TokenMint1111111111111111111111111111111",
      signalTime: "2026-09-08T14:10:00Z",
      wallets: [walletB], // smartScore 30, existing WA has 50
    };
    const merged = mergeEventWallets(existing(), detection);
    expect(merged.minSmartScore).toBe(30);
    expect(merged.maxSmartScore).toBe(50);
    expect(merged.avgSmartScore).toBeCloseTo(40);
  });

  it("newEventFields builds a first-detection record with no merge", () => {
    const detection: NewDetection = {
      tokenMint: "TokenMint1111111111111111111111111111111",
      signalTime: "2026-09-08T14:00:00Z",
      wallets: [walletA, walletB],
    };
    const fields = newEventFields(detection);
    expect(fields.walletCount).toBe(2);
    expect(fields.avgSmartScore).toBeCloseTo(40);
  });
});
