export interface DemoStrategy {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  startingCapitalUsd: number;
  minSmartScore: number;
  minWalletsRequired: number;
  signalWindowMinutes: number;
  virtualBuySizeUsd: number;
  maxOpenPositions: number;
  maxAllocationPctPerToken: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  maxPositionAgeHours: number | null;
  simulatedSlippagePct: number;
  feePct: number;
  minTokenLiquidityUsd: number | null;
  minMarketCapUsd: number | null;
  maxMarketCapUsd: number | null;
  createdAt: string;
}

export interface DemoAccount {
  strategyId: string;
  cashBalanceUsd: number;
}

export interface DemoPosition {
  id: string;
  strategyId: string;
  signalId: string;
  tokenMint: string;
  tokenSymbol: string | null;
  status: "OPEN" | "CLOSED";
  entryPrice: number;
  quantity: number;
  positionSizeUsd: number;
  entryTime: string;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  maxPositionAgeHours: number | null;
  exitRule: string | null;
  exitTime: string | null;
  exitPrice: number | null;
  feesUsd: number;
  grossPnlUsd: number | null;
  netPnlUsd: number | null;
}

export interface DemoTrade {
  id: string;
  strategyId: string;
  positionId: string;
  signalId: string | null;
  action: "BUY" | "SELL";
  tokenMint: string;
  tokenSymbol: string | null;
  referenceMarketPrice: number;
  executionPrice: number;
  simulatedSlippagePct: number;
  quantity: number;
  usdValue: number;
  feesUsd: number;
  grossPnlUsd: number | null;
  netPnlUsd: number | null;
  executedAt: string;
}

export interface DemoPortfolioSnapshot {
  snapshotAt: string;
  cashBalanceUsd: number;
  openPositionValueUsd: number;
  totalValueUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  roiPct: number;
}

export interface CreateStrategyInput {
  name: string;
  startingCapitalUsd: number;
  minSmartScore?: number;
  minWalletsRequired?: number;
  signalWindowMinutes?: number;
  virtualBuySizeUsd?: number;
  maxOpenPositions?: number;
  maxAllocationPctPerToken?: number;
  stopLossPct?: number | null;
  takeProfitPct?: number | null;
  maxPositionAgeHours?: number | null;
  simulatedSlippagePct?: number;
  feePct?: number;
}
