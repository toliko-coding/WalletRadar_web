import { describe, expect, it } from "vitest";
import { detectConvergenceSignals, type TrackedBuy } from "@/lib/smart-money/detect-convergence";

const TOKEN_A = "TokenAMint1111111111111111111111111111111";
const TOKEN_B = "TokenBMint2222222222222222222222222222222";

function buy(overrides: Partial<TrackedBuy>): TrackedBuy {
  return {
    walletAddress: "Wallet1",
    tokenMint: TOKEN_A,
    tokenSymbol: "TOKA",
    occurredAt: "2026-08-01T12:00:00Z",
    usdValue: 1000,
    smartScore: 80,
    ...overrides,
  };
}

describe("detectConvergenceSignals", () => {
  it("detects a signal when enough distinct wallets buy the same token within the window", () => {
    const buys = [
      buy({ walletAddress: "W1", occurredAt: "2026-08-01T12:00:00Z", usdValue: 1000 }),
      buy({ walletAddress: "W2", occurredAt: "2026-08-01T12:30:00Z", usdValue: 2000 }),
      buy({ walletAddress: "W3", occurredAt: "2026-08-01T13:00:00Z", usdValue: 500 }),
    ];
    const [signal] = detectConvergenceSignals(buys, { minWallets: 2, windowMinutes: 180 });
    expect(signal.walletCount).toBe(3);
    expect(signal.totalBuyVolumeUsd).toBe(3500);
    expect(signal.averageSmartScore).toBe(80);
    expect(signal.firstBuyAt).toBe("2026-08-01T12:00:00Z");
    expect(signal.latestBuyAt).toBe("2026-08-01T13:00:00Z");
  });

  it("does not produce a signal below the minimum wallet count", () => {
    const buys = [buy({ walletAddress: "W1" }), buy({ walletAddress: "W2" })];
    const signals = detectConvergenceSignals(buys, { minWallets: 3, windowMinutes: 180 });
    expect(signals).toHaveLength(0);
  });

  it("excludes buys outside the rolling window anchored at the latest buy", () => {
    const buys = [
      buy({ walletAddress: "W1", occurredAt: "2026-08-01T00:00:00Z" }), // 12h before the latest — outside a 3h window
      buy({ walletAddress: "W2", occurredAt: "2026-08-01T11:50:00Z" }),
      buy({ walletAddress: "W3", occurredAt: "2026-08-01T12:00:00Z" }),
    ];
    const [signal] = detectConvergenceSignals(buys, { minWallets: 2, windowMinutes: 180 });
    expect(signal.walletCount).toBe(2);
    expect(signal.wallets.map((w) => w.walletAddress)).toEqual(["W2", "W3"]);
  });

  it("counts a single wallet's repeated buys of the same token only once", () => {
    const buys = [
      buy({ walletAddress: "W1", occurredAt: "2026-08-01T12:00:00Z" }),
      buy({ walletAddress: "W1", occurredAt: "2026-08-01T12:10:00Z" }),
      buy({ walletAddress: "W2", occurredAt: "2026-08-01T12:20:00Z" }),
    ];
    const signals = detectConvergenceSignals(buys, { minWallets: 3, windowMinutes: 180 });
    // Only 2 unique wallets ever touched this token — 3 distinct wallets required, so no signal.
    expect(signals).toHaveLength(0);
  });

  it("uses each wallet's most recent buy timestamp, not its first, when windowing", () => {
    const buys = [
      buy({ walletAddress: "W1", occurredAt: "2026-08-01T00:00:00Z" }), // W1's first buy, long ago
      buy({ walletAddress: "W1", occurredAt: "2026-08-01T12:00:00Z" }), // W1's latest buy — this is what should count
      buy({ walletAddress: "W2", occurredAt: "2026-08-01T12:05:00Z" }),
    ];
    const [signal] = detectConvergenceSignals(buys, { minWallets: 2, windowMinutes: 30 });
    expect(signal.walletCount).toBe(2);
  });

  it("filters out signals below a minimum combined USD threshold", () => {
    const buys = [
      buy({ walletAddress: "W1", usdValue: 10 }),
      buy({ walletAddress: "W2", usdValue: 10 }),
    ];
    const signals = detectConvergenceSignals(buys, { minWallets: 2, windowMinutes: 180, minCombinedUsd: 1000 });
    expect(signals).toHaveLength(0);
  });

  it("keeps separate tokens as separate signals", () => {
    const buys = [
      buy({ walletAddress: "W1", tokenMint: TOKEN_A, tokenSymbol: "TOKA" }),
      buy({ walletAddress: "W2", tokenMint: TOKEN_A, tokenSymbol: "TOKA" }),
      buy({ walletAddress: "W1", tokenMint: TOKEN_B, tokenSymbol: "TOKB" }),
      buy({ walletAddress: "W2", tokenMint: TOKEN_B, tokenSymbol: "TOKB" }),
    ];
    const signals = detectConvergenceSignals(buys, { minWallets: 2, windowMinutes: 180 });
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.tokenMint).sort()).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("sorts signals by wallet count descending, then by most recent", () => {
    const buys = [
      buy({ walletAddress: "W1", tokenMint: TOKEN_A, occurredAt: "2026-08-01T10:00:00Z" }),
      buy({ walletAddress: "W2", tokenMint: TOKEN_A, occurredAt: "2026-08-01T10:05:00Z" }),
      buy({ walletAddress: "W1", tokenMint: TOKEN_B, occurredAt: "2026-08-01T11:00:00Z" }),
      buy({ walletAddress: "W2", tokenMint: TOKEN_B, occurredAt: "2026-08-01T11:05:00Z" }),
      buy({ walletAddress: "W3", tokenMint: TOKEN_B, occurredAt: "2026-08-01T11:10:00Z" }),
    ];
    const signals = detectConvergenceSignals(buys, { minWallets: 2, windowMinutes: 180 });
    expect(signals[0].tokenMint).toBe(TOKEN_B); // 3 wallets beats 2
    expect(signals[1].tokenMint).toBe(TOKEN_A);
  });

  it("returns no signals for an empty input", () => {
    expect(detectConvergenceSignals([], { minWallets: 2, windowMinutes: 60 })).toEqual([]);
  });
});
