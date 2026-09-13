import { describe, expect, it, beforeEach } from "vitest";
import { getGlobalTokenBucket } from "@/lib/rate-limit/global-token-bucket";

const KEY = "test-provider";

beforeEach(() => {
  // Simulate a fresh process for each test by clearing this key's slot —
  // otherwise the whole point (singleton-across-"copies") can't be tested
  // in isolation between cases.
  delete (globalThis as Record<string, unknown>)[`__walletradar_token_bucket__${KEY}`];
});

describe("getGlobalTokenBucket", () => {
  it("returns the same instance across repeated calls with the same key — simulating separate module copies both resolving to one bucket", () => {
    const first = getGlobalTokenBucket(KEY, 1, 1);
    const second = getGlobalTokenBucket(KEY, 1, 1);
    expect(second).toBe(first);
  });

  it("returns a different instance for a different key (Birdeye and Helius stay independently rate-limited)", () => {
    const birdeye = getGlobalTokenBucket("birdeye-test", 1, 1);
    const helius = getGlobalTokenBucket("helius-test", 5, 5);
    expect(birdeye).not.toBe(helius);
  });

  it("ignores capacity/refill args on a second call for an already-created key (first call wins, matching a real singleton)", () => {
    const first = getGlobalTokenBucket(KEY, 1, 1);
    const second = getGlobalTokenBucket(KEY, 999, 999);
    expect(second).toBe(first);
  });
});
