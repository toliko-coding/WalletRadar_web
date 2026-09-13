import { describe, expect, it } from "vitest";
import { pickMaintenanceJob, classifyBudgetTier, isDiscoveryBacklogBlocked } from "@/lib/automation/maintenance-priority";

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
