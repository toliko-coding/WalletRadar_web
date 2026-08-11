/**
 * Shared domain types for WalletRadar. Kept provider-agnostic: values here
 * are what the UI/DB deal with, after provider-specific responses have been
 * mapped by src/lib/providers/*.
 */

/** How trustworthy a given financial figure is — never present an estimate as exact (§50). */
export type DataReliability =
  | "EXACT"
  | "ON_CHAIN"
  | "PROVIDER_CALCULATED"
  | "CALCULATED"
  | "ESTIMATED"
  | "UNAVAILABLE";

export interface ReliableValue<T> {
  value: T | null;
  reliability: DataReliability;
}

export type TransactionType =
  | "DEX_SWAP_BUY"
  | "DEX_SWAP_SELL"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "AIRDROP"
  | "STAKE"
  | "LP_ACTION"
  | "UNKNOWN";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type TraderType =
  | "SMART_TRADER"
  | "MANUAL_UNKNOWN"
  | "BOT_SUSPECTED"
  | "SNIPER"
  | "INSIDER_TAGGED"
  | "DEVELOPER"
  | "BUNDLER";

export interface Trade {
  signature: string;
  walletAddress: string;
  type: TransactionType;
  tokenMint: string;
  tokenSymbol: string | null;
  tokenAmount: number;
  usdValue: ReliableValue<number>;
  executionPrice: ReliableValue<number>;
  realizedPnlUsd: ReliableValue<number>;
  timestamp: string; // ISO 8601
  explorerUrl: string;
}

export interface Position {
  tokenMint: string;
  tokenSymbol: string | null;
  quantity: number;
  currentPrice: ReliableValue<number>;
  currentValueUsd: ReliableValue<number>;
  costBasisUsd: ReliableValue<number>;
  averageEntryPrice: ReliableValue<number>;
  unrealizedPnlUsd: ReliableValue<number>;
  unrealizedRoiPct: ReliableValue<number>;
  firstBuyAt: string | null;
  latestBuyAt: string | null;
  numBuys: number;
  numPartialSells: number;
}

export interface WalletMetrics {
  walletAddress: string;
  windowLabel: string; // e.g. "90D"
  realizedPnlUsd: ReliableValue<number>;
  unrealizedPnlUsd: ReliableValue<number>;
  totalPnlUsd: ReliableValue<number>;
  roiPct: ReliableValue<number>;
  winRatePct: ReliableValue<number>;
  tradeCount: number;
  volumeUsd: ReliableValue<number>;
  avgTradeSizeUsd: ReliableValue<number>;
  avgHoldDurationHours: ReliableValue<number>;
  maxDrawdownPct: ReliableValue<number>;
  walletAgeDays: number | null;
  tradingHistoryDays: number | null;
  lastActivityAt: string | null;
  profitConcentrationPct: ReliableValue<number>;
  profitConcentrationTokenSymbol: string | null;
  riskLevel: RiskLevel;
  traderType: TraderType;
}

export interface SmartScoreComponent {
  key:
    | "consistency"
    | "riskAdjustedProfitability"
    | "realizedPnlQuality"
    | "winRateQuality"
    | "drawdown"
    | "sampleSize"
    | "tradingHistory"
    | "recentActivity";
  label: string;
  weightPct: number;
  normalizedScore: number; // 0-100 before weighting
}

export interface SmartScoreResult {
  score: number; // 0-100
  components: SmartScoreComponent[];
  strengths: string[];
  risks: string[];
  penaltiesApplied: string[];
}

export interface WalletAnalysis {
  walletAddress: string;
  metrics: WalletMetrics;
  smartScore: SmartScoreResult;
  positions: Position[];
  trades: Trade[];
  eligible: boolean;
  rejectionReason: string | null;
  analyzedAt: string;
}
