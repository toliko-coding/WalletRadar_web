import { describe, expect, it } from "vitest";
import {
  pickMaintenanceJob,
  classifyBudgetTier,
  isDiscoveryBacklogBlocked,
  describeBudgetTier,
  describeBacklogState,
} from "@/lib/automation/maintenance-priority";

describe("pickMaintenanceJob", () => {
  it("returns null when nothing is eligible", () => {
    expect(pickMaintenanceJob(new Set())).toBeNull();
  });

  it("prefers refresh over exploration and discovery", () => {
    expect(pickMaintenanceJob(new Set(["refresh", "exploration", "discovery"]))).toBe("refresh");
  });

  it("prefers exploration over discovery when refresh isn't eligible", () => {
    expect(pickMaintenanceJob(new Set(["exploration", "discovery"]))).toBe("exploration");
  });

  it("falls back to discovery when it's the only one eligible", () => {
    expect(pickMaintenanceJob(new Set(["discovery"]))).toBe("discovery");
  });
});

describe("classifyBudgetTier", () => {
  it("all three types eligible below the reserve threshold", () => {
    expect(classifyBudgetTier(399, 400, 500)).toEqual(new Set(["refresh", "exploration", "discovery"]));
  });

  it("only refresh eligible in the reserve band [reserveThreshold, dailyBudget)", () => {
    expect(classifyBudgetTier(400, 400, 500)).toEqual(new Set(["refresh"]));
    expect(classifyBudgetTier(499, 400, 500)).toEqual(new Set(["refresh"]));
  });

  it("nothing eligible at/above the daily budget", () => {
    expect(classifyBudgetTier(500, 400, 500)).toEqual(new Set());
    expect(classifyBudgetTier(9999, 400, 500)).toEqual(new Set());
  });
});

describe("isDiscoveryBacklogBlocked", () => {
  it("is not blocked below the high-water mark", () => {
    expect(isDiscoveryBacklogBlocked(499, 500)).toBe(false);
  });

  it("is blocked exactly at the high-water mark", () => {
    expect(isDiscoveryBacklogBlocked(500, 500)).toBe(true);
  });

  it("is blocked well above the high-water mark", () => {
    expect(isDiscoveryBacklogBlocked(609, 500)).toBe(true);
  });
});

describe("describeBacklogState", () => {
  it("is 'Normal' below the high-water mark", () => {
    expect(describeBacklogState(100, 500)).toBe("Normal");
  });

  it("is 'Discovery paused by backlog gate' at/above the high-water mark", () => {
    expect(describeBacklogState(500, 500)).toBe("Discovery paused by backlog gate");
    expect(describeBacklogState(609, 500)).toBe("Discovery paused by backlog gate");
  });
});

describe("describeBudgetTier", () => {
  it("describes the all-eligible tier", () => {
    expect(describeBudgetTier(new Set(["refresh", "exploration", "discovery"]))).toBe("Refresh + Exploration + Discovery allowed");
  });

  it("describes the refresh-only tier", () => {
    expect(describeBudgetTier(new Set(["refresh"]))).toBe("Refresh only");
  });

  it("describes the nothing-eligible tier", () => {
    expect(describeBudgetTier(new Set())).toBe("Maintenance paused for provider budget");
  });
});
