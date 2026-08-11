import "server-only";
import { birdeyeRequest } from "./client";
import { cached } from "@/lib/cache/api-cache";
import type {
  Position,
  ReliableValue,
  WalletMetrics,
} from "@/types/domain";
import type { WalletAnalyticsProvider, WalletPnlWindow } from "@/lib/providers/types";

// --- Raw Birdeye response shapes (docs.birdeye.so, verified Aug 2026) ---

interface PnlSummaryResponse {
  summary: {
    unique_tokens: number;
    counts: {
      total_buy: number;
      total_sell: number;
      total_trade: number;
      total_win: number;
      total_loss: number;
      win_rate: number;
    };
    cashflow_usd: {
      total_invested: number;
      total_sold: number;
      current_value: number;
    };
    pnl: {
      realized_profit_usd: number;
      realized_profit_percent: number;
      unrealized_usd: number;
      total_usd: number;
      avg_profit_per_trade_usd: number;
    };
  };
}

interface PnlDetailsToken {
  symbol: string | null;
  decimals: number;
  address: string;
  counts: {
    total_buy: number;
    total_sell: number;
    total_trade: number;
    total_win: number;
    total_loss: number;
    win_rate: number;
  };
  quantity: { total_bought_amount: number; total_sold_amount: number; holding: number };
  cashflow_usd: {
    cost_of_quantity_sold: number;
    total_invested: number;
    total_sold: number;
    current_value: number;
  };
  pnl: {
    realized_profit_usd: number;
    realized_profit_percent: number;
    unrealized_usd: number;
    unrealized_percent: number;
    total_usd: number;
    total_percent: number;
    avg_profit_per_trade_usd: number;
  };
  pricing: { current_price: number | null; avg_buy_cost: number | null; avg_sell_cost: number | null };
}

interface PnlDetailsResponse {
  tokens: PnlDetailsToken[];
  summary: PnlSummaryResponse["summary"];
  address: string;
}

export interface PnlChartPoint {
  timestamp: string;
  realized_pnl: number;
  total_volume_usd: number;
  total_token_traded: number;
  total_tx_count: number;
}

interface PnlChartResponse {
  data: PnlChartPoint[];
}

interface TopTraderItem {
  owner: string;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  volumeUsd: number;
  trade: number;
  firstTradeUnixTime: number;
  lastTradeUnixTime: number;
  tags: string[];
}

interface TopTradersResponse {
  items: TopTraderItem[];
}

interface TrendingTokenItem {
  address: string;
  symbol: string | null;
  volume24hUSD: number;
}

interface TrendingTokensResponse {
  tokens: TrendingTokenItem[];
}

const DURATION_BY_WINDOW: Record<string, string> = {
  "7D": "7d",
  "30D": "30d",
  "90D": "90d",
  "180D": "90d", // Birdeye's largest bucket short of "all" is 90d
  "1Y": "all",
  ALL: "all",
};

function toReliable<T>(value: T | null | undefined, reliability: ReliableValue<T>["reliability"]): ReliableValue<T> {
  if (value === null || value === undefined || Number.isNaN(value as unknown as number)) {
    return { value: null, reliability: "UNAVAILABLE" };
  }
  return { value, reliability };
}

export async function getWalletPnlSummary(
  walletAddress: string,
  windowLabel: string
): Promise<PnlSummaryResponse> {
  const duration = DURATION_BY_WINDOW[windowLabel] ?? "all";
  return cached(`birdeye:pnl-summary:${walletAddress}:${duration}`, 300, () =>
    birdeyeRequest<PnlSummaryResponse>("/wallet/v2/pnl/summary", {
      query: { wallet: walletAddress, duration },
    })
  );
}

export async function getWalletPnlDetails(
  walletAddress: string,
  windowLabel: string
): Promise<PnlDetailsResponse> {
  const duration = DURATION_BY_WINDOW[windowLabel] ?? "all";
  return cached(`birdeye:pnl-details:${walletAddress}:${duration}`, 300, () =>
    birdeyeRequest<PnlDetailsResponse>("/wallet/v2/pnl/details", {
      method: "POST",
      body: { wallet: walletAddress, duration, limit: 100, sort_by: "last_trade" },
    })
  );
}

export async function getWalletPnlChart(walletAddress: string): Promise<PnlChartPoint[]> {
  const res = await cached(`birdeye:pnl-chart:${walletAddress}`, 300, () =>
    birdeyeRequest<PnlChartResponse>("/wallet/v2/pnl/chart", {
      query: { wallet: walletAddress, position_scope: "cumulative" },
    })
  );
  return res.data ?? [];
}

function mapPnlSummaryToMetrics(
  walletAddress: string,
  windowLabel: string,
  summary: PnlSummaryResponse["summary"]
): WalletMetrics {
  const realized = summary.pnl.realized_profit_usd;
  const unrealized = summary.pnl.unrealized_usd;
  const invested = summary.cashflow_usd.total_invested;

  return {
    walletAddress,
    windowLabel,
    realizedPnlUsd: toReliable(realized, "PROVIDER_CALCULATED"),
    unrealizedPnlUsd: toReliable(unrealized, "PROVIDER_CALCULATED"),
    totalPnlUsd: toReliable(summary.pnl.total_usd, "PROVIDER_CALCULATED"),
    roiPct: toReliable(
      invested > 0 ? (summary.pnl.total_usd / invested) * 100 : null,
      "CALCULATED"
    ),
    winRatePct: toReliable(summary.counts.win_rate * 100, "PROVIDER_CALCULATED"),
    tradeCount: summary.counts.total_trade,
    volumeUsd: toReliable(invested + summary.cashflow_usd.total_sold, "CALCULATED"),
    avgTradeSizeUsd: toReliable(
      summary.counts.total_trade > 0
        ? (invested + summary.cashflow_usd.total_sold) / summary.counts.total_trade
        : null,
      "CALCULATED"
    ),
    avgHoldDurationHours: { value: null, reliability: "UNAVAILABLE" },
    maxDrawdownPct: { value: null, reliability: "UNAVAILABLE" },
    walletAgeDays: null,
    tradingHistoryDays: null,
    lastActivityAt: null,
    profitConcentrationPct: { value: null, reliability: "UNAVAILABLE" },
    profitConcentrationTokenSymbol: null,
    riskLevel: "MEDIUM",
    traderType: "MANUAL_UNKNOWN",
  };
}

export const birdeyeWalletAnalytics: WalletAnalyticsProvider = {
  async getWalletPnL(walletAddress, windowLabel): Promise<WalletPnlWindow> {
    const { summary } = await getWalletPnlSummary(walletAddress, windowLabel);
    return { windowLabel, metrics: mapPnlSummaryToMetrics(walletAddress, windowLabel, summary) };
  },

  async getWalletBalances(walletAddress): Promise<Position[]> {
    const { tokens } = await getWalletPnlDetails(walletAddress, "ALL");
    return tokens
      .filter((t) => t.quantity.holding > 0)
      .map((t) => ({
        tokenMint: t.address,
        tokenSymbol: t.symbol,
        quantity: t.quantity.holding,
        currentPrice: toReliable(t.pricing.current_price, "PROVIDER_CALCULATED"),
        currentValueUsd: toReliable(t.cashflow_usd.current_value, "PROVIDER_CALCULATED"),
        costBasisUsd: toReliable(
          t.cashflow_usd.total_invested - t.cashflow_usd.cost_of_quantity_sold,
          "PROVIDER_CALCULATED"
        ),
        averageEntryPrice: toReliable(t.pricing.avg_buy_cost, "PROVIDER_CALCULATED"),
        unrealizedPnlUsd: toReliable(t.pnl.unrealized_usd, "PROVIDER_CALCULATED"),
        unrealizedRoiPct: toReliable(t.pnl.unrealized_percent, "PROVIDER_CALCULATED"),
        firstBuyAt: null, // enriched from trade feed where available (see analyze route)
        latestBuyAt: null,
        numBuys: t.counts.total_buy,
        numPartialSells: t.counts.total_sell,
      }));
  },

  async getWalletProfitByToken(walletAddress) {
    const { tokens } = await getWalletPnlDetails(walletAddress, "ALL");
    return tokens.map((t) => ({
      tokenMint: t.address,
      tokenSymbol: t.symbol,
      profitUsd: t.pnl.total_usd,
    }));
  },

  async getTopTokenTraders(tokenMint, opts) {
    const res = await cached(
      `birdeye:top-traders:${tokenMint}:${opts?.timeFrame ?? "7d"}`,
      600,
      () =>
        birdeyeRequest<TopTradersResponse>("/defi/v2/tokens/top_traders", {
          query: {
            address: tokenMint,
            time_frame: opts?.timeFrame ?? "7d",
            sort_by: "total_pnl",
            sort_type: "desc",
            limit: opts?.limit ?? 10,
          },
        })
    );
    return res.items.map((item) => ({
      walletAddress: item.owner,
      realizedPnlUsd: item.realizedPnl,
      volumeUsd: item.volumeUsd,
      tradeCount: item.trade,
      tags: item.tags ?? [],
    }));
  },

  async getTrendingTokens(limit = 10) {
    const res = await cached(`birdeye:trending:${limit}`, 300, () =>
      birdeyeRequest<TrendingTokensResponse>("/defi/token_trending", {
        query: { sort_by: "volumeUSD", sort_type: "desc", limit },
      })
    );
    return res.tokens.map((t) => ({
      tokenMint: t.address,
      symbol: t.symbol,
      volume24hUsd: t.volume24hUSD,
    }));
  },
};
