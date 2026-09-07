import type { TraderType } from "@/types/domain";

/**
 * §6: "Bots should not automatically be rejected. Instead: detect suspected
 * automation/bot behavior, label it, allow user filtering." This is a
 * heuristic on trade frequency alone — real data already shows wallets with
 * hundreds of thousands to millions of DEX trades inside a 90-day window
 * (e.g. 2,513,211 in one observed case), which is not achievable by a human
 * clicking a trading UI. Deliberately simple and transparent rather than a
 * multi-factor model: a false positive here only adds a filterable label,
 * never an exclusion (BOT_SUSPECTED is not in RECOMMENDED_EXCLUDED_TRADER_TYPES).
 */
export const BOT_SUSPECTED_TRADE_COUNT_THRESHOLD = 5_000;

export function isTradeFrequencyBotLike(tradeCountInWindow: number): boolean {
  return tradeCountInWindow >= BOT_SUSPECTED_TRADE_COUNT_THRESHOLD;
}

/**
 * Resolves the final trader type for a wallet, given whatever discovery
 * already learned (Birdeye's own wallet_tags — see trader-type.ts) and this
 * wallet's own observed trade frequency. Specific, higher-confidence tags
 * from discovery (developer/bundler/insider/sniper) are never overridden by
 * the generic bot-frequency heuristic — those are more specific signals
 * about *why* a wallet behaves the way it does, whereas "bot suspected" is
 * just "trades faster than a human plausibly could".
 */
export function resolveTraderType(
  discoveryHint: TraderType | undefined,
  tradeCountInWindow: number
): TraderType {
  const specificTags: TraderType[] = ["DEVELOPER", "BUNDLER", "INSIDER_TAGGED", "SNIPER"];
  if (discoveryHint && specificTags.includes(discoveryHint)) return discoveryHint;
  if (isTradeFrequencyBotLike(tradeCountInWindow)) return "BOT_SUSPECTED";
  return discoveryHint ?? "MANUAL_UNKNOWN";
}
