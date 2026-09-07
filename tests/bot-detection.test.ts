import { describe, expect, it } from "vitest";
import { isTradeFrequencyBotLike, resolveTraderType, BOT_SUSPECTED_TRADE_COUNT_THRESHOLD } from "@/lib/discovery/bot-detection";

describe("isTradeFrequencyBotLike", () => {
  it("does not flag a plausible human trade count", () => {
    expect(isTradeFrequencyBotLike(183)).toBe(false);
  });

  it("flags a trade count at the threshold", () => {
    expect(isTradeFrequencyBotLike(BOT_SUSPECTED_TRADE_COUNT_THRESHOLD)).toBe(true);
  });

  it("flags an obviously non-human trade count (real observed case)", () => {
    expect(isTradeFrequencyBotLike(2_513_211)).toBe(true);
  });
});

describe("resolveTraderType", () => {
  it("defaults to MANUAL_UNKNOWN with no hint and a plausible trade count", () => {
    expect(resolveTraderType(undefined, 100)).toBe("MANUAL_UNKNOWN");
  });

  it("keeps a discovery hint when trade frequency looks human", () => {
    expect(resolveTraderType("SMART_TRADER", 100)).toBe("SMART_TRADER");
  });

  it("overrides SMART_TRADER with BOT_SUSPECTED when trade frequency is inhuman", () => {
    // A wallet Birdeye's own top-traders tags "smart_trader" can still be a
    // bot underneath — the tag says "profitable", not "human".
    expect(resolveTraderType("SMART_TRADER", 1_000_000)).toBe("BOT_SUSPECTED");
  });

  it("overrides an absent hint with BOT_SUSPECTED when trade frequency is inhuman", () => {
    expect(resolveTraderType(undefined, 1_000_000)).toBe("BOT_SUSPECTED");
  });

  it("never overrides a more specific discovery tag (developer/bundler/insider/sniper) with the generic bot label", () => {
    expect(resolveTraderType("DEVELOPER", 1_000_000)).toBe("DEVELOPER");
    expect(resolveTraderType("BUNDLER", 1_000_000)).toBe("BUNDLER");
    expect(resolveTraderType("INSIDER_TAGGED", 1_000_000)).toBe("INSIDER_TAGGED");
    expect(resolveTraderType("SNIPER", 1_000_000)).toBe("SNIPER");
  });
});
