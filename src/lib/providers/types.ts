import type { Position, Trade, WalletMetrics } from "@/types/domain";

/**
 * Provider abstractions (§49). Business logic depends only on these
 * interfaces, never on a specific vendor's request/response shape, so
 * swapping Birdeye/Helius for another vendor — or adding another chain —
 * doesn't touch calling code.
 */

export interface WalletPnlWindow {
  windowLabel: string; // "7D" | "30D" | "90D" | "180D" | "1Y" | "ALL"
  metrics: WalletMetrics;
}

export interface WalletAnalyticsProvider {
  /** Aggregate, provider-calculated PnL/trading stats for a wallet over a window. */
  getWalletPnL(walletAddress: string, windowLabel: string): Promise<WalletPnlWindow>;

  /** Current token holdings/portfolio for a wallet. */
  getWalletBalances(walletAddress: string): Promise<Position[]>;

  /** Per-token profit breakdown, used for profit-concentration analysis (§11). */
  getWalletProfitByToken(
    walletAddress: string
  ): Promise<Array<{ tokenMint: string; tokenSymbol: string | null; profitUsd: number }>>;

  /** Top traders for a given token — a discovery source (§4). */
  getTopTokenTraders(
    tokenMint: string,
    opts?: { timeFrame?: string; limit?: number }
  ): Promise<
    Array<{ walletAddress: string; realizedPnlUsd: number; volumeUsd: number; tradeCount: number }>
  >;
}

export interface TransactionProvider {
  /** Classified/enhanced transaction history for a wallet, newest first. */
  getWalletTransactions(
    walletAddress: string,
    opts?: { limit?: number; before?: string }
  ): Promise<Trade[]>;
}

export interface MarketDataProvider {
  getTokenPrice(tokenMint: string): Promise<{ priceUsd: number | null }>;
  getTokenLiquidity(tokenMint: string): Promise<{ liquidityUsd: number | null }>;
}

export interface TokenMetadataProvider {
  getTokenMetadata(
    tokenMint: string
  ): Promise<{ symbol: string | null; name: string | null; decimals: number | null }>;
}

export interface RealtimeProvider {
  /** Registers a wallet address with the provider's push/webhook mechanism (Phase 1G). */
  subscribeToWallet(walletAddress: string): Promise<void>;
  unsubscribeFromWallet(walletAddress: string): Promise<void>;
}
