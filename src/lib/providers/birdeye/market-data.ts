import "server-only";
import { birdeyeRequest } from "./client";
import { cached } from "@/lib/cache/api-cache";
import type { MarketDataProvider, TokenMetadataProvider } from "@/lib/providers/types";

interface PriceResponse {
  value: number | null;
  liquidity: number | null;
}

interface TokenOverviewResponse {
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  liquidity: number | null;
}

export const birdeyeMarketData: MarketDataProvider = {
  async getTokenPrice(tokenMint) {
    const data = await cached(`birdeye:price:${tokenMint}`, 30, () =>
      birdeyeRequest<PriceResponse>("/defi/price", { query: { address: tokenMint } })
    );
    return { priceUsd: data?.value ?? null };
  },

  async getTokenLiquidity(tokenMint) {
    const data = await cached(`birdeye:overview:${tokenMint}`, 300, () =>
      birdeyeRequest<TokenOverviewResponse>("/defi/token_overview", {
        query: { address: tokenMint },
      })
    );
    return { liquidityUsd: data?.liquidity ?? null };
  },
};

export const birdeyeTokenMetadata: TokenMetadataProvider = {
  async getTokenMetadata(tokenMint) {
    const data = await cached(`birdeye:overview:${tokenMint}`, 300, () =>
      birdeyeRequest<TokenOverviewResponse>("/defi/token_overview", {
        query: { address: tokenMint },
      })
    );
    return {
      symbol: data?.symbol ?? null,
      name: data?.name ?? null,
      decimals: data?.decimals ?? null,
    };
  },
};
