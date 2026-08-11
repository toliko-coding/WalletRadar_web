import { describe, expect, it } from "vitest";
import { traderTypeFromTags, RECOMMENDED_EXCLUDED_TRADER_TYPES } from "@/lib/discovery/trader-type";
import { mergeDiscoveryHit, type CandidateWalletRecord } from "@/lib/discovery/merge-candidate";

describe("traderTypeFromTags", () => {
  it("maps each known Birdeye tag to the matching TraderType", () => {
    expect(traderTypeFromTags(["dev"])).toBe("DEVELOPER");
    expect(traderTypeFromTags(["bundler"])).toBe("BUNDLER");
    expect(traderTypeFromTags(["insider"])).toBe("INSIDER_TAGGED");
    expect(traderTypeFromTags(["sniper"])).toBe("SNIPER");
    expect(traderTypeFromTags(["smart_trader"])).toBe("SMART_TRADER");
  });

  it("defaults to MANUAL_UNKNOWN when there are no tags", () => {
    expect(traderTypeFromTags([])).toBe("MANUAL_UNKNOWN");
  });

  it("prefers a negative signal (dev) over a positive one (smart_trader) when both are present", () => {
    // A wallet Birdeye tags as both "dev" and "smart_trader" must still be
    // excludable by the Recommended preset — silently picking the flattering
    // tag would let it slip past the developer-exclusion check.
    expect(traderTypeFromTags(["smart_trader", "dev"])).toBe("DEVELOPER");
  });

  it("is case-insensitive", () => {
    expect(traderTypeFromTags(["DEV"])).toBe("DEVELOPER");
  });

  it("every excluded trader type is actually reachable from a real Birdeye tag", () => {
    for (const excluded of RECOMMENDED_EXCLUDED_TRADER_TYPES) {
      const reachable = ["dev", "bundler", "insider"].some((tag) => traderTypeFromTags([tag]) === excluded);
      expect(reachable).toBe(true);
    }
  });
});

describe("mergeDiscoveryHit", () => {
  it("creates a new record with 1 hit on first sighting", () => {
    const record = mergeDiscoveryHit(null, {
      walletAddress: "W1",
      tokenMint: "TokenA",
      source: "trending_top_traders",
      discoveredAt: "2026-08-01T00:00:00Z",
    });
    expect(record).toEqual<CandidateWalletRecord>({
      walletAddress: "W1",
      firstDiscoveredAt: "2026-08-01T00:00:00Z",
      lastDiscoveredAt: "2026-08-01T00:00:00Z",
      discoverySource: "trending_top_traders",
      numberOfDiscoveryHits: 1,
      tokensDiscoveredFrom: ["TokenA"],
    });
  });

  it("increments hits and appends a new token on a repeat sighting from a different token", () => {
    const first = mergeDiscoveryHit(null, {
      walletAddress: "W1",
      tokenMint: "TokenA",
      source: "trending_top_traders",
      discoveredAt: "2026-08-01T00:00:00Z",
    });
    const second = mergeDiscoveryHit(first, {
      walletAddress: "W1",
      tokenMint: "TokenB",
      source: "trending_top_traders",
      discoveredAt: "2026-08-02T00:00:00Z",
    });
    expect(second.numberOfDiscoveryHits).toBe(2);
    expect(second.tokensDiscoveredFrom).toEqual(["TokenA", "TokenB"]);
    expect(second.lastDiscoveredAt).toBe("2026-08-02T00:00:00Z");
  });

  it("does not duplicate a token already recorded, but still counts the hit", () => {
    const first = mergeDiscoveryHit(null, {
      walletAddress: "W1",
      tokenMint: "TokenA",
      source: "trending_top_traders",
      discoveredAt: "2026-08-01T00:00:00Z",
    });
    const second = mergeDiscoveryHit(first, {
      walletAddress: "W1",
      tokenMint: "TokenA",
      source: "trending_top_traders",
      discoveredAt: "2026-08-02T00:00:00Z",
    });
    expect(second.numberOfDiscoveryHits).toBe(2);
    expect(second.tokensDiscoveredFrom).toEqual(["TokenA"]);
  });

  it("preserves the original first_discovered_at across merges", () => {
    const first = mergeDiscoveryHit(null, {
      walletAddress: "W1",
      tokenMint: "TokenA",
      source: "trending_top_traders",
      discoveredAt: "2026-08-01T00:00:00Z",
    });
    const second = mergeDiscoveryHit(first, {
      walletAddress: "W1",
      tokenMint: "TokenB",
      source: "trending_top_traders",
      discoveredAt: "2026-08-05T00:00:00Z",
    });
    expect(second.firstDiscoveredAt).toBe("2026-08-01T00:00:00Z");
  });

  it("never lets last_discovered_at move backward when hits arrive out of order", () => {
    const first = mergeDiscoveryHit(null, {
      walletAddress: "W1",
      tokenMint: "TokenA",
      source: "trending_top_traders",
      discoveredAt: "2026-08-05T00:00:00Z",
    });
    const second = mergeDiscoveryHit(first, {
      walletAddress: "W1",
      tokenMint: "TokenB",
      source: "trending_top_traders",
      discoveredAt: "2026-08-01T00:00:00Z", // earlier than the existing record
    });
    expect(second.lastDiscoveredAt).toBe("2026-08-05T00:00:00Z");
  });
});
