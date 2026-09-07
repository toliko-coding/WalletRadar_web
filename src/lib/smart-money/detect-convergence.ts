/**
 * Pure convergence-detection logic (§20-22) — no I/O, so it's testable
 * without a database. Takes buys already fetched for the "tracked" wallet
 * pool and finds tokens where enough distinct wallets bought within a
 * rolling time window anchored at that token's most recent qualifying buy.
 *
 * This is retrospective, computed from already-stored wallet_trades rows —
 * there's no live monitoring loop (Phase 1G) yet, so "first detected" here
 * means "the earliest qualifying buy we have on record", not "the moment
 * our system saw it happen". Honest about that; never implied as real-time.
 */
export interface TrackedBuy {
  walletAddress: string;
  tokenMint: string;
  tokenSymbol: string | null;
  occurredAt: string; // ISO
  usdValue: number | null;
  smartScore: number | null;
}

export interface ConvergenceSignalWallet {
  walletAddress: string;
  smartScore: number | null;
  usdValue: number | null;
  occurredAt: string;
}

export interface ConvergenceSignal {
  tokenMint: string;
  tokenSymbol: string | null;
  walletCount: number;
  wallets: ConvergenceSignalWallet[];
  totalBuyVolumeUsd: number;
  averageSmartScore: number | null;
  firstBuyAt: string;
  latestBuyAt: string;
}

export interface ConvergenceCriteria {
  minWallets: number;
  windowMinutes: number;
  minCombinedUsd?: number;
}

export function detectConvergenceSignals(
  buys: TrackedBuy[],
  criteria: ConvergenceCriteria
): ConvergenceSignal[] {
  const byToken = new Map<string, TrackedBuy[]>();
  for (const buy of buys) {
    const list = byToken.get(buy.tokenMint);
    if (list) list.push(buy);
    else byToken.set(buy.tokenMint, [buy]);
  }

  const signals: ConvergenceSignal[] = [];

  for (const [tokenMint, tokenBuys] of byToken) {
    // Only each wallet's most recent buy of this token counts — a single
    // wallet buying the same token five times must not look like five
    // independent wallets converging on it.
    const latestPerWallet = new Map<string, TrackedBuy>();
    for (const buy of tokenBuys) {
      const existing = latestPerWallet.get(buy.walletAddress);
      if (!existing || new Date(buy.occurredAt) > new Date(existing.occurredAt)) {
        latestPerWallet.set(buy.walletAddress, buy);
      }
    }

    const uniqueBuys = [...latestPerWallet.values()].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );
    if (uniqueBuys.length < criteria.minWallets) continue;

    const latestBuyAt = uniqueBuys[uniqueBuys.length - 1].occurredAt;
    const windowStartMs = new Date(latestBuyAt).getTime() - criteria.windowMinutes * 60_000;
    const qualifying = uniqueBuys.filter((b) => new Date(b.occurredAt).getTime() >= windowStartMs);

    if (qualifying.length < criteria.minWallets) continue;

    const totalBuyVolumeUsd = qualifying.reduce((sum, b) => sum + (b.usdValue ?? 0), 0);
    if (criteria.minCombinedUsd !== undefined && totalBuyVolumeUsd < criteria.minCombinedUsd) continue;

    const scores = qualifying.map((b) => b.smartScore).filter((s): s is number => s !== null);
    const averageSmartScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    signals.push({
      tokenMint,
      tokenSymbol: qualifying.find((b) => b.tokenSymbol)?.tokenSymbol ?? null,
      walletCount: qualifying.length,
      wallets: qualifying.map((b) => ({
        walletAddress: b.walletAddress,
        smartScore: b.smartScore,
        usdValue: b.usdValue,
        occurredAt: b.occurredAt,
      })),
      totalBuyVolumeUsd,
      averageSmartScore,
      firstBuyAt: qualifying[0].occurredAt,
      latestBuyAt: qualifying[qualifying.length - 1].occurredAt,
    });
  }

  return signals.sort((a, b) => {
    if (b.walletCount !== a.walletCount) return b.walletCount - a.walletCount;
    return new Date(b.latestBuyAt).getTime() - new Date(a.latestBuyAt).getTime();
  });
}
