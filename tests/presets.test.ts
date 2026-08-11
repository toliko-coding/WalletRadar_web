import { describe, expect, it } from "vitest";
import { resolveFilterCriteria, PRESETS } from "@/lib/discovery/presets";
import { nullableLteFilter, nullableGteFilter, inListLiteral } from "@/lib/discovery/query-filters";

describe("resolveFilterCriteria", () => {
  it("defaults to the Recommended preset with no params", () => {
    const result = resolveFilterCriteria({});
    expect(result.presetId).toBe("recommended");
    expect(result.isCustom).toBe(false);
    expect(result.criteria).toEqual(PRESETS.recommended.criteria);
  });

  it("resolves a named builtin preset exactly, with no overrides", () => {
    const result = resolveFilterCriteria({ preset: "aggressive" });
    expect(result.presetId).toBe("aggressive");
    expect(result.isCustom).toBe(false);
    expect(result.criteria).toEqual(PRESETS.aggressive.criteria);
  });

  it("falls back to Recommended for an unrecognized preset id", () => {
    const result = resolveFilterCriteria({ preset: "not-a-real-preset" });
    expect(result.criteria).toEqual(PRESETS.recommended.criteria);
  });

  it("treats an explicit preset=custom as custom even with no overrides", () => {
    const result = resolveFilterCriteria({ preset: "custom" });
    expect(result.presetId).toBe("custom");
    expect(result.isCustom).toBe(true);
    // With no overrides, custom still starts from Recommended's numbers.
    expect(result.criteria).toEqual(PRESETS.recommended.criteria);
  });

  it("marks the result custom when any filter field is overridden, even without preset=custom", () => {
    const result = resolveFilterCriteria({ preset: "conservative", minTrades: "5" });
    expect(result.isCustom).toBe(true);
    expect(result.presetId).toBe("custom");
    expect(result.criteria.minTrades).toBe(5);
    // Untouched fields still come from the named base preset (conservative), not Recommended.
    expect(result.criteria.minVolumeUsd).toBe(PRESETS.conservative.criteria.minVolumeUsd);
  });

  it("ignores non-numeric override values instead of corrupting the criteria", () => {
    const result = resolveFilterCriteria({ minTrades: "not-a-number" });
    expect(result.isCustom).toBe(false);
    expect(result.criteria.minTrades).toBe(PRESETS.recommended.criteria.minTrades);
  });

  it("applies a valid riskLevel override", () => {
    const result = resolveFilterCriteria({ riskLevel: "LOW" });
    expect(result.isCustom).toBe(true);
    expect(result.criteria.riskLevel).toBe("LOW");
  });

  it("ignores an invalid riskLevel value", () => {
    const result = resolveFilterCriteria({ riskLevel: "SUPER_RISKY" });
    expect(result.isCustom).toBe(false);
    expect(result.criteria.riskLevel).toBe("ALL");
  });
});

describe("nullable query-filter builders", () => {
  it("builds a null-or-lte filter string", () => {
    expect(nullableLteFilter("max_drawdown_pct", 30)).toBe("max_drawdown_pct.is.null,max_drawdown_pct.lte.30");
  });

  it("builds a null-or-gte filter string", () => {
    expect(nullableGteFilter("roi_pct", 10)).toBe("roi_pct.is.null,roi_pct.gte.10");
  });

  it("builds a Postgres array literal for an IN filter", () => {
    expect(inListLiteral(["DEVELOPER", "BUNDLER"])).toBe("(DEVELOPER,BUNDLER)");
  });
});
