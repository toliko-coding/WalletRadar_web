import "server-only";
import { heliusGet } from "./client";
import { classifyTransaction, WRAPPED_SOL_MINT, type RawEnhancedTransaction } from "@/lib/classification/classify-transaction";
import { birdeyeMarketData } from "@/lib/providers/birdeye/market-data";
import type { Trade } from "@/types/domain";
import type { TransactionProvider } from "@/lib/providers/types";

async function getSolPriceUsd(): Promise<number | null> {
  try {
    const { priceUsd } = await birdeyeMarketData.getTokenPrice(WRAPPED_SOL_MINT);
    return priceUsd;
  } catch {
    // SOL-denominated swap USD values degrade to UNAVAILABLE rather than blocking the feed.
    return null;
  }
}

export const heliusTransactions: TransactionProvider = {
  async getWalletTransactions(walletAddress, opts) {
    const raw = await heliusGet<RawEnhancedTransaction[]>(
      `/v0/addresses/${walletAddress}/transactions`,
      {
        limit: opts?.limit ?? 50,
        "before-signature": opts?.before,
      }
    );

    const solPriceUsd = await getSolPriceUsd();

    const trades: Trade[] = [];
    for (const tx of raw) {
      trades.push(...classifyTransaction(tx, walletAddress, { solPriceUsd }));
    }
    return trades;
  },
};
