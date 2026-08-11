import type { TraderType } from "@/types/domain";

/**
 * Maps Birdeye's wallet_tags (dev/bundler/sniper/insider/smart_trader) onto
 * our TraderType enum. Priority order matters when a wallet carries more than
 * one tag: negative signals (developer/bundler/insider) must win over a
 * positive one like smart_trader, since the Recommended preset excludes them
 * (§6/7) — silently preferring "smart_trader" would let an excluded wallet
 * back in through the eligibility check in analyzeWallet().
 */
const PRIORITY: Array<{ tag: string; type: TraderType }> = [
  { tag: "dev", type: "DEVELOPER" },
  { tag: "bundler", type: "BUNDLER" },
  { tag: "insider", type: "INSIDER_TAGGED" },
  { tag: "sniper", type: "SNIPER" },
  { tag: "smart_trader", type: "SMART_TRADER" },
];

export function traderTypeFromTags(tags: string[]): TraderType {
  const normalized = new Set(tags.map((t) => t.toLowerCase()));
  for (const { tag, type } of PRIORITY) {
    if (normalized.has(tag)) return type;
  }
  return "MANUAL_UNKNOWN";
}

/** Trader types the Recommended preset excludes outright, regardless of other metrics (§6/7). */
export const RECOMMENDED_EXCLUDED_TRADER_TYPES: readonly TraderType[] = [
  "DEVELOPER",
  "BUNDLER",
  "INSIDER_TAGGED",
];
