import { describe, expect, it } from "vitest";
import {
  classifyTransaction,
  WRAPPED_SOL_MINT,
  type RawEnhancedTransaction,
} from "@/lib/classification/classify-transaction";

const WALLET = "WaLLeT1111111111111111111111111111111111";
const OTHER = "OtheR2222222222222222222222222222222222222";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MEME_MINT = "MemeMint33333333333333333333333333333333";

function baseTx(overrides: Partial<RawEnhancedTransaction>): RawEnhancedTransaction {
  return {
    signature: "sig1",
    timestamp: 1_754_000_000,
    type: "TRANSFER",
    source: null,
    tokenTransfers: [],
    nativeTransfers: [],
    ...overrides,
  };
}

describe("classifyTransaction — §18 requirement: never guess buy/sell from a plain transfer", () => {
  it("classifies a SWAP where the wallet pays USDC and receives a token as DEX_SWAP_BUY", () => {
    const tx = baseTx({
      type: "SWAP",
      tokenTransfers: [
        { fromUserAccount: OTHER, toUserAccount: WALLET, tokenAmount: 1000, mint: MEME_MINT },
        { fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 50, mint: USDC_MINT },
      ],
    });

    const [trade] = classifyTransaction(tx, WALLET);
    expect(trade.type).toBe("DEX_SWAP_BUY");
    expect(trade.tokenMint).toBe(MEME_MINT);
    expect(trade.tokenAmount).toBe(1000);
    expect(trade.usdValue.value).toBe(50);
    expect(trade.usdValue.reliability).toBe("ON_CHAIN");
    expect(trade.executionPrice.value).toBeCloseTo(0.05);
  });

  it("classifies a SWAP where the wallet sells a token for SOL as DEX_SWAP_SELL, priced via the supplied SOL price (ESTIMATED)", () => {
    const tx = baseTx({
      type: "SWAP",
      tokenTransfers: [
        { fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 200, mint: MEME_MINT },
        { fromUserAccount: OTHER, toUserAccount: WALLET, tokenAmount: 2, mint: WRAPPED_SOL_MINT },
      ],
    });

    const [trade] = classifyTransaction(tx, WALLET, { solPriceUsd: 150 });
    expect(trade.type).toBe("DEX_SWAP_SELL");
    expect(trade.usdValue.value).toBe(300); // 2 SOL * $150
    expect(trade.usdValue.reliability).toBe("ESTIMATED");
  });

  it("never fabricates a USD value for a SOL-denominated swap when no SOL price is available", () => {
    const tx = baseTx({
      type: "SWAP",
      tokenTransfers: [
        { fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 200, mint: MEME_MINT },
        { fromUserAccount: OTHER, toUserAccount: WALLET, tokenAmount: 2, mint: WRAPPED_SOL_MINT },
      ],
    });

    const [trade] = classifyTransaction(tx, WALLET, { solPriceUsd: null });
    expect(trade.usdValue.value).toBeNull();
    expect(trade.usdValue.reliability).toBe("UNAVAILABLE");
    expect(trade.executionPrice.value).toBeNull();
  });

  it("classifies a direct SOL<->USDC swap (a market maker trading SOL itself) as a real trade, not UNKNOWN", () => {
    // Regression test: this is the exact shape a real wallet's transactions
    // came back as in live testing. Both legs "look like" quote currencies
    // under a naive SOL-or-stablecoin-is-always-quote rule, so the old
    // classifier silently dropped every one of these into UNKNOWN.
    const sellTx = baseTx({
      type: "SWAP",
      tokenTransfers: [
        { fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 1.034577048, mint: WRAPPED_SOL_MINT },
        { fromUserAccount: OTHER, toUserAccount: WALLET, tokenAmount: 77.433093, mint: USDC_MINT },
      ],
    });
    const [sell] = classifyTransaction(sellTx, WALLET);
    expect(sell.type).toBe("DEX_SWAP_SELL");
    expect(sell.tokenMint).toBe(WRAPPED_SOL_MINT);
    expect(sell.tokenAmount).toBeCloseTo(1.034577048);
    expect(sell.usdValue.value).toBeCloseTo(77.433093);
    expect(sell.usdValue.reliability).toBe("ON_CHAIN");

    const buyTx = baseTx({
      type: "SWAP",
      tokenTransfers: [
        { fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 2000.005426, mint: USDC_MINT },
        { fromUserAccount: OTHER, toUserAccount: WALLET, tokenAmount: 26.709221457, mint: WRAPPED_SOL_MINT },
      ],
    });
    const [buy] = classifyTransaction(buyTx, WALLET);
    expect(buy.type).toBe("DEX_SWAP_BUY");
    expect(buy.tokenMint).toBe(WRAPPED_SOL_MINT);
    expect(buy.usdValue.value).toBeCloseTo(2000.005426);
  });

  it("does not guess which side is the traded asset in a stable-for-stable swap", () => {
    const usdtMint = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    const tx = baseTx({
      type: "SWAP",
      tokenTransfers: [
        { fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 100, mint: USDC_MINT },
        { fromUserAccount: OTHER, toUserAccount: WALLET, tokenAmount: 100, mint: usdtMint },
      ],
    });
    const [trade] = classifyTransaction(tx, WALLET);
    expect(trade.type).toBe("UNKNOWN");
  });

  it("classifies a plain incoming transfer as TRANSFER_IN, not a buy", () => {
    const tx = baseTx({
      type: "TRANSFER",
      tokenTransfers: [{ fromUserAccount: OTHER, toUserAccount: WALLET, tokenAmount: 500, mint: MEME_MINT }],
    });

    const [trade] = classifyTransaction(tx, WALLET);
    expect(trade.type).toBe("TRANSFER_IN");
  });

  it("classifies a plain outgoing transfer as TRANSFER_OUT, not a sell", () => {
    const tx = baseTx({
      type: "TRANSFER",
      tokenTransfers: [{ fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 500, mint: MEME_MINT }],
    });

    const [trade] = classifyTransaction(tx, WALLET);
    expect(trade.type).toBe("TRANSFER_OUT");
  });

  it("classifies stake-program interactions as STAKE", () => {
    const tx = baseTx({ type: "STAKE_TOKEN", tokenTransfers: [{ fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 10, mint: MEME_MINT }] });
    const [trade] = classifyTransaction(tx, WALLET);
    expect(trade.type).toBe("STAKE");
  });

  it("falls back to UNKNOWN for unrecognized transaction types rather than guessing", () => {
    const tx = baseTx({
      type: "SOME_NEW_HELIUS_TYPE",
      tokenTransfers: [{ fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 10, mint: MEME_MINT }],
    });
    const [trade] = classifyTransaction(tx, WALLET);
    expect(trade.type).toBe("UNKNOWN");
  });

  it("produces no trade records when the wallet isn't a party to any transfer in the tx", () => {
    const tx = baseTx({
      type: "TRANSFER",
      tokenTransfers: [{ fromUserAccount: OTHER, toUserAccount: "SomeoneElse", tokenAmount: 10, mint: MEME_MINT }],
    });
    expect(classifyTransaction(tx, WALLET)).toHaveLength(0);
  });
});
