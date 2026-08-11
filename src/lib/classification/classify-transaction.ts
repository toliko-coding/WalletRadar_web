import type { ReliableValue, Trade, TransactionType } from "@/types/domain";

/** Reduced shape of a Helius Enhanced Transaction — only the fields we classify on. */
export interface RawEnhancedTransaction {
  signature: string;
  timestamp: number; // unix seconds
  type: string; // Helius's raw type, e.g. "SWAP", "TRANSFER", "STAKE_TOKEN", ...
  source: string | null;
  tokenTransfers: Array<{
    fromUserAccount: string | null;
    toUserAccount: string | null;
    tokenAmount: number;
    mint: string;
  }>;
  nativeTransfers: Array<{
    fromUserAccount: string | null;
    toUserAccount: string | null;
    amount: number; // lamports
  }>;
}

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLECOIN_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

function isQuoteMint(mint: string): boolean {
  return mint === WRAPPED_SOL_MINT || STABLECOIN_MINTS.has(mint);
}

function explorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

function unavailable<T>(): ReliableValue<T> {
  return { value: null, reliability: "UNAVAILABLE" };
}

function stableUsdValue<T extends number>(amount: T, mint: string): ReliableValue<number> {
  if (STABLECOIN_MINTS.has(mint)) return { value: amount, reliability: "ON_CHAIN" };
  return unavailable();
}

/**
 * Classifies a raw enhanced transaction into zero or more domain Trades from
 * the perspective of `walletAddress` (§18). Only SWAP transactions where the
 * wallet trades a token against SOL/a stablecoin are ever labeled as
 * DEX_SWAP_BUY/SELL — everything else defaults to a non-trade category or
 * UNKNOWN rather than being guessed.
 */
export function classifyTransaction(
  tx: RawEnhancedTransaction,
  walletAddress: string,
  opts: { solPriceUsd?: number | null } = {}
): Trade[] {
  const timestamp = new Date(tx.timestamp * 1000).toISOString();

  if (tx.type === "SWAP") {
    return classifySwap(tx, walletAddress, timestamp, opts.solPriceUsd ?? null);
  }

  if (tx.type === "STAKE_TOKEN" || tx.type === "STAKE_SOL" || tx.type === "UNSTAKE_SOL") {
    return buildNonTradeRecords(tx, walletAddress, timestamp, "STAKE");
  }

  if (tx.type.includes("LIQUIDITY") || tx.type.startsWith("LP_")) {
    return buildNonTradeRecords(tx, walletAddress, timestamp, "LP_ACTION");
  }

  if (tx.type === "TRANSFER") {
    return buildTransferRecords(tx, walletAddress, timestamp);
  }

  return buildNonTradeRecords(tx, walletAddress, timestamp, "UNKNOWN");
}

function classifySwap(
  tx: RawEnhancedTransaction,
  walletAddress: string,
  timestamp: string,
  solPriceUsd: number | null
): Trade[] {
  const received = tx.tokenTransfers.filter((t) => t.toUserAccount === walletAddress);
  const sent = tx.tokenTransfers.filter((t) => t.fromUserAccount === walletAddress);

  const nonQuoteReceived = received.filter((t) => !isQuoteMint(t.mint));
  const nonQuoteSent = sent.filter((t) => !isQuoteMint(t.mint));
  const quoteReceived = received.find((t) => isQuoteMint(t.mint));
  const quoteSent = sent.find((t) => isQuoteMint(t.mint));

  const trades: Trade[] = [];

  // BUY: wallet received a non-quote token and paid with SOL/stablecoin.
  if (nonQuoteReceived.length === 1 && (quoteSent || nonQuoteReceived.length !== received.length)) {
    const tokenIn = nonQuoteReceived[0];
    const usdValue = quoteSent ? resolveQuoteUsd(quoteSent.tokenAmount, quoteSent.mint, solPriceUsd) : unavailable<number>();
    trades.push(
      buildTrade(tx, walletAddress, timestamp, "DEX_SWAP_BUY", tokenIn.mint, tokenIn.tokenAmount, usdValue)
    );
  }

  // SELL: wallet sent a non-quote token and received SOL/stablecoin.
  if (nonQuoteSent.length === 1 && (quoteReceived || nonQuoteSent.length !== sent.length)) {
    const tokenOut = nonQuoteSent[0];
    const usdValue = quoteReceived
      ? resolveQuoteUsd(quoteReceived.tokenAmount, quoteReceived.mint, solPriceUsd)
      : unavailable<number>();
    trades.push(
      buildTrade(tx, walletAddress, timestamp, "DEX_SWAP_SELL", tokenOut.mint, tokenOut.tokenAmount, usdValue)
    );
  }

  if (trades.length === 0) {
    return buildNonTradeRecords(tx, walletAddress, timestamp, "UNKNOWN");
  }

  return trades;
}

function resolveQuoteUsd(amount: number, mint: string, solPriceUsd: number | null): ReliableValue<number> {
  if (STABLECOIN_MINTS.has(mint)) return { value: amount, reliability: "ON_CHAIN" };
  if (mint === WRAPPED_SOL_MINT && solPriceUsd !== null) {
    return { value: amount * solPriceUsd, reliability: "ESTIMATED" };
  }
  return unavailable();
}

function buildTransferRecords(
  tx: RawEnhancedTransaction,
  walletAddress: string,
  timestamp: string
): Trade[] {
  const relevant = tx.tokenTransfers.filter(
    (t) => t.toUserAccount === walletAddress || t.fromUserAccount === walletAddress
  );
  if (relevant.length === 0) return [];

  return relevant.map((t) => {
    const type: TransactionType = t.toUserAccount === walletAddress ? "TRANSFER_IN" : "TRANSFER_OUT";
    return buildTrade(tx, walletAddress, timestamp, type, t.mint, t.tokenAmount, stableUsdValue(t.tokenAmount, t.mint));
  });
}

function buildNonTradeRecords(
  tx: RawEnhancedTransaction,
  walletAddress: string,
  timestamp: string,
  type: TransactionType
): Trade[] {
  const relevant = tx.tokenTransfers.filter(
    (t) => t.toUserAccount === walletAddress || t.fromUserAccount === walletAddress
  );
  if (relevant.length === 0) {
    // No token movement we can attribute (e.g. a stake instruction on native SOL only) —
    // still surface it in the feed as UNKNOWN/typed with a placeholder mint.
    return [buildTrade(tx, walletAddress, timestamp, type, "unknown", 0, unavailable())];
  }
  return relevant.map((t) =>
    buildTrade(tx, walletAddress, timestamp, type, t.mint, t.tokenAmount, stableUsdValue(t.tokenAmount, t.mint))
  );
}

function buildTrade(
  tx: RawEnhancedTransaction,
  walletAddress: string,
  timestamp: string,
  type: TransactionType,
  tokenMint: string,
  tokenAmount: number,
  usdValue: ReliableValue<number>
): Trade {
  const executionPrice: ReliableValue<number> =
    usdValue.value !== null && tokenAmount > 0
      ? { value: usdValue.value / tokenAmount, reliability: usdValue.reliability }
      : unavailable();

  return {
    signature: tx.signature,
    walletAddress,
    type,
    tokenMint,
    tokenSymbol: null,
    tokenAmount,
    usdValue,
    executionPrice,
    realizedPnlUsd: unavailable(), // filled in by cost-basis module for SELLs where applicable
    timestamp,
    explorerUrl: explorerUrl(tx.signature),
  };
}
