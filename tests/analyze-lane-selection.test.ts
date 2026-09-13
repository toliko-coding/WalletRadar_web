import { describe, expect, it } from "vitest";
import { computeMinActiveSmartScoreThreshold, isStale } from "@/lib/jobs/analyze-lane-selection";

describe("computeMinActiveSmartScoreThreshold", () => {
  it("returns null when there are no strategies at all", () => {
    expect(computeMinActiveSmartScoreThreshold([])).toBeNull();
  });

  it("returns null when every strategy is PAUSED", () => {
    expect(
      computeMinActiveSmartScoreThreshold([
        { status: "PAUSED", minSmartScore: 50 },
        { status: "PAUSED", minSmartScore: 30 },
      ])
    ).toBeNull();
  });

  it("returns the single ACTIVE strategy's threshold, ignoring PAUSED ones", () => {
    expect(
      computeMinActiveSmartScoreThreshold([
        { status: "ACTIVE", minSmartScore: 50 },
        { status: "PAUSED", minSmartScore: 0 },
      ])
    ).toBe(50);
  });

  it("returns the MINIMUM threshold across multiple ACTIVE strategies with different thresholds", () => {
    expect(
      computeMinActiveSmartScoreThreshold([
        { status: "ACTIVE", minSmartScore: 70 },
        { status: "ACTIVE", minSmartScore: 40 },
        { status: "ACTIVE", minSmartScore: 55 },
      ])
    ).toBe(40);
  });
});

describe("isStale", () => {
  const now = new Date("2026-09-14T12:00:00Z");

  it("is never stale when computedAt is null (no analysis on record — belongs to exploration, not refresh)", () => {
    expect(isStale(null, 24, now)).toBe(false);
  });

  it("is not stale when the analysis is younger than the staleness window", () => {
    expect(isStale("2026-09-14T00:00:01Z", 24, now)).toBe(false); // ~12h old
  });

  it("is stale exactly at the staleness boundary", () => {
    expect(isStale("2026-09-13T12:00:00Z", 24, now)).toBe(true); // exactly 24h old
  });

  it("is stale well past the staleness window", () => {
    expect(isStale("2026-09-01T00:00:00Z", 24, now)).toBe(true);
  });
});
