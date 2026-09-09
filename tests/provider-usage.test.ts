import { describe, expect, it, vi, afterEach } from "vitest";
import { getUtcDateString, mergeCounts } from "@/lib/telemetry/provider-usage";

describe("getUtcDateString", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns YYYY-MM-DD", () => {
    expect(getUtcDateString(new Date("2026-09-09T14:23:00Z"))).toBe("2026-09-09");
  });

  it("is always UTC, regardless of the local timezone the process is running in", () => {
    // A time that's a different calendar day in UTC-8 (23:30 local) vs UTC
    // (07:30 the next day) — this is exactly the class of bug "never use
    // toLocaleDateString()" guards against.
    const date = new Date("2026-09-09T23:30:00-08:00"); // = 2026-09-10T07:30:00Z
    expect(getUtcDateString(date)).toBe("2026-09-10");
  });

  it("defaults to the current time when no date is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T00:00:01Z"));
    expect(getUtcDateString()).toBe("2026-01-15");
  });
});

describe("mergeCounts", () => {
  it("starts from an empty bucket when nothing existed before", () => {
    const result = mergeCounts(undefined, { outboundAttempts: 1, successfulRequests: 1 });
    expect(result).toEqual({ outboundAttempts: 1, successfulRequests: 1, retries: 0, cacheHits: 0, cacheMisses: 0 });
  });

  it("accumulates onto an existing bucket rather than replacing it", () => {
    const existing = { outboundAttempts: 3, successfulRequests: 2, retries: 1, cacheHits: 5, cacheMisses: 1 };
    const result = mergeCounts(existing, { outboundAttempts: 2, retries: 1 });
    expect(result).toEqual({ outboundAttempts: 5, successfulRequests: 2, retries: 2, cacheHits: 5, cacheMisses: 1 });
  });

  it("treats every field as optional, defaulting an omitted increment field to 0", () => {
    const existing = { outboundAttempts: 1, successfulRequests: 1, retries: 0, cacheHits: 0, cacheMisses: 0 };
    const result = mergeCounts(existing, { cacheHits: 1 });
    expect(result).toEqual({ outboundAttempts: 1, successfulRequests: 1, retries: 0, cacheHits: 1, cacheMisses: 0 });
  });

  it("accumulates correctly across repeated calls, independent of any particular branch", () => {
    let counts = mergeCounts(undefined, { outboundAttempts: 1, successfulRequests: 1 });
    counts = mergeCounts(counts, { outboundAttempts: 3, retries: 2, successfulRequests: 1 });
    counts = mergeCounts(counts, { cacheHits: 1 });
    counts = mergeCounts(counts, { cacheMisses: 1 });
    expect(counts).toEqual({ outboundAttempts: 4, successfulRequests: 2, retries: 2, cacheHits: 1, cacheMisses: 1 });
  });
});
