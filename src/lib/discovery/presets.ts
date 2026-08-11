import type { RiskLevel, TraderType } from "@/types/domain";

/**
 * Only fields backed by real, currently-populated wallet_metrics/wallets
 * columns are here (§6-8). Wallet age, minimum profitable-tokens count, and
 * average hold duration are UNAVAILABLE per Phase 1B's own design (see
 * src/lib/analysis/analyze-wallet.ts) and are deliberately not filterable —
 * wiring a filter to a column that's always null would silently hide
 * everything or do nothing, neither of which is honest.
 */
export interface FilterCriteria {
  limit: number;
  minTrades: number;
  minVolumeUsd: number;
  minWinRatePct: number;
  maxDrawdownPct: number;
  minTradingHistoryDays: number;
  recentActivityDays: number;
  minRoiPct: number;
  minPnlUsd: number; // realized PnL floor — §6 prefers realized over unrealized
  minAvgTradeSizeUsd: number;
  riskLevel: RiskLevel | "ALL";
  traderType: TraderType | "ALL";
  /** Excluded outright regardless of other criteria — mirrors analyzeWallet()'s Recommended-eligibility exclusion (§6/7). */
  excludeTraderTypes: TraderType[];
}

export type BuiltinPresetId = "recommended" | "conservative" | "aggressive" | "meme" | "recently_hot";
export type PresetId = BuiltinPresetId | "custom";

export interface Preset {
  id: BuiltinPresetId;
  label: string;
  description: string;
  criteria: FilterCriteria;
}

const EXCLUDE_DEV_BUNDLER_INSIDER: TraderType[] = ["DEVELOPER", "BUNDLER", "INSIDER_TAGGED"];

/** Base defaults every preset starts from, then overrides only what makes it distinct. */
const BASE: FilterCriteria = {
  limit: 10,
  minTrades: 0,
  minVolumeUsd: 0,
  minWinRatePct: 0,
  maxDrawdownPct: 100,
  minTradingHistoryDays: 0,
  recentActivityDays: 30,
  minRoiPct: -1_000,
  minPnlUsd: -1_000_000_000,
  minAvgTradeSizeUsd: 0,
  riskLevel: "ALL",
  traderType: "ALL",
  excludeTraderTypes: EXCLUDE_DEV_BUNDLER_INSIDER,
};

export const PRESETS: Record<BuiltinPresetId, Preset> = {
  recommended: {
    id: "recommended",
    label: "Recommended",
    description: "Best balance of profit, consistency, history, and risk. Default preset.",
    criteria: {
      ...BASE,
      limit: 10,
      minTrades: 50,
      minVolumeUsd: 10_000,
      minWinRatePct: 55,
      maxDrawdownPct: 30,
      recentActivityDays: 7,
    },
  },
  conservative: {
    id: "conservative",
    label: "Conservative",
    description: "Long trading history, low drawdown, higher trade count, high consistency.",
    criteria: {
      ...BASE,
      limit: 10,
      minTrades: 100,
      minVolumeUsd: 25_000,
      minWinRatePct: 60,
      maxDrawdownPct: 20,
      minTradingHistoryDays: 60,
      recentActivityDays: 14,
    },
  },
  aggressive: {
    id: "aggressive",
    label: "Aggressive",
    description: "Higher ROI, more volatility allowed, shorter history allowed.",
    criteria: {
      ...BASE,
      limit: 25,
      minTrades: 20,
      minVolumeUsd: 5_000,
      minWinRatePct: 45,
      maxDrawdownPct: 50,
      minRoiPct: 25,
    },
  },
  meme: {
    id: "meme",
    label: "Meme Coin Traders",
    description: "Active Solana memecoin traders — smaller, more frequent trades tolerated.",
    criteria: {
      ...BASE,
      limit: 25,
      minTrades: 30,
      minVolumeUsd: 5_000,
      minWinRatePct: 40,
      maxDrawdownPct: 60,
      recentActivityDays: 3,
    },
  },
  recently_hot: {
    id: "recently_hot",
    label: "Recently Hot",
    description:
      "Focused on the last few days of activity. Uses 90D-window data — the only window batch analysis computes today.",
    criteria: {
      ...BASE,
      limit: 25,
      minTrades: 10,
      minVolumeUsd: 1_000,
      recentActivityDays: 1,
    },
  },
};

export const DEFAULT_PRESET_ID: BuiltinPresetId = "recommended";

function isBuiltinPresetId(value: string | undefined): value is BuiltinPresetId {
  return value !== undefined && value in PRESETS;
}

function parseNumberParam(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseStringParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "" ? undefined : value;
}

const OVERRIDE_KEYS: Array<keyof FilterCriteria> = [
  "limit",
  "minTrades",
  "minVolumeUsd",
  "minWinRatePct",
  "maxDrawdownPct",
  "minTradingHistoryDays",
  "recentActivityDays",
  "minRoiPct",
  "minPnlUsd",
  "minAvgTradeSizeUsd",
];

export interface ResolvedFilters {
  presetId: PresetId;
  isCustom: boolean;
  criteria: FilterCriteria;
}

/**
 * Pure — no I/O. Resolves URL search params into a concrete FilterCriteria.
 * Robust to a client that doesn't perfectly set preset=custom itself: any
 * recognized override param present forces isCustom, regardless of what the
 * `preset` param says.
 */
export function resolveFilterCriteria(
  searchParams: Record<string, string | string[] | undefined>
): ResolvedFilters {
  const presetParam = parseStringParam(searchParams.preset);
  const basePreset = isBuiltinPresetId(presetParam) ? PRESETS[presetParam] : PRESETS[DEFAULT_PRESET_ID];

  const overrides: Partial<FilterCriteria> = {};
  let hasOverride = false;
  for (const key of OVERRIDE_KEYS) {
    const parsed = parseNumberParam(searchParams[key]);
    if (parsed !== undefined) {
      (overrides as Record<string, number>)[key] = parsed;
      hasOverride = true;
    }
  }

  const riskLevelParam = parseStringParam(searchParams.riskLevel);
  if (riskLevelParam === "LOW" || riskLevelParam === "MEDIUM" || riskLevelParam === "HIGH" || riskLevelParam === "ALL") {
    if (riskLevelParam !== basePreset.criteria.riskLevel) hasOverride = true;
    overrides.riskLevel = riskLevelParam;
  }

  const traderTypeParam = parseStringParam(searchParams.traderType);
  const validTraderTypes: Array<TraderType | "ALL"> = [
    "ALL",
    "SMART_TRADER",
    "MANUAL_UNKNOWN",
    "BOT_SUSPECTED",
    "SNIPER",
  ];
  if (traderTypeParam && (validTraderTypes as string[]).includes(traderTypeParam)) {
    if (traderTypeParam !== basePreset.criteria.traderType) hasOverride = true;
    overrides.traderType = traderTypeParam as TraderType | "ALL";
  }

  const isCustom = presetParam === "custom" || hasOverride;

  return {
    presetId: isCustom ? "custom" : basePreset.id,
    isCustom,
    criteria: { ...basePreset.criteria, ...overrides },
  };
}
