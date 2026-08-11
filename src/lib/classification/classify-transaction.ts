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

/**
 * Higher priority = more "quote-like". A stablecoin is always the quote
 * side of a swap; SOL is the quote side against an arbitrary token but is
 * itself the *traded asset* when swapped directly against a stablecoin
 * (e.g. a market maker buying/selling SOL/USDC) — a plain "is this SOL or a
 * stablecoin" boolean can't express that, which is why an earlier version of
 * this classifier silently dropped every SOL/USDC swap into UNKNOWN (neither
 * leg looked like "the token being traded").
 */
function quotePriority(mint: string): number {
  if (STABLECOIN_MINTS.has(mint)) return 2;
  if (mint === WRAPPED_SOL_MINT) return 1;
  return 0;
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

  // Only the common case — the wallet received exactly one token leg and
  // sent exactly one token leg — is classified as a trade. Multi-hop routes
  // that touch the wallet's accounts more than once on a side fall through
  // to UNKNOWN rather than guessing which leg is "the" trade.
  if (received.length !== 1 || sent.length !== 1) {
    return buildNonTradeRecords(tx, walletAddress, timestamp, "UNKNOWN");
  }

  const inLeg = received[0];
  const outLeg = sent[0];
  const inPriority = quotePriority(inLeg.mint);
  const outPriority = quotePriority(outLeg.mint);

  if (inPriority === outPriority) {
    // Equal priority (e.g. stable-for-stable, or two mints we don't recognize
    // as SOL/a stablecoin) — we can't tell which side is "the traded asset".
    return buildNonTradeRecords(tx, walletAddress, timestamp, "UNKNOWN");
  }

  if (inPriority < outPriority) {
    // Received the lower-priority (traded) asset, paid with the higher-priority (quote) asset.
    const usdValue = resolveQuoteUsd(outLeg.tokenAmount, outLeg.mint, solPriceUsd);
    return [buildTrade(tx, walletAddress, timestamp, "DEX_SWAP_BUY", inLeg.mint, inLeg.tokenAmount, usdValue)];
  }

  // Sent the lower-priority (traded) asset, received the higher-priority (quote) asset.
  const usdValue = resolveQuoteUsd(inLeg.tokenAmount, inLeg.mint, solPriceUsd);
  return [buildTrade(tx, walletAddress, timestamp, "DEX_SWAP_SELL", outLeg.mint, outLeg.tokenAmount, usdValue)];
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
