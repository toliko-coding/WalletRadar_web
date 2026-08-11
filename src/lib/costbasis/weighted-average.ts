/**
 * Weighted Average Cost basis (§19). This is the ESTIMATED fallback used only
 * when a provider hasn't already supplied cost-basis figures for a wallet+
 * token (Birdeye's `wallet/v2/pnl/details` is preferred and tagged
 * PROVIDER_CALCULATED — see src/lib/providers/birdeye/wallet-analytics.ts).
 * The methodology is fixed here and must not be silently changed per-call.
 */

export interface CostBasisEvent {
  type: "BUY" | "SELL";
  amount: number; // token quantity, > 0
  usdValue: number; // USD value of this leg of the trade, >= 0
  timestamp: string;
}

export interface SellResult {
  timestamp: string;
  amountSold: number;
  proceedsUsd: number;
  costOfSoldUsd: number;
  realizedPnlUsd: number;
  /** false when the sale exceeds tracked buy history — the trade window didn't capture every prior buy. */
  costBasisComplete: boolean;
}

export interface CostBasisResult {
  remainingQuantity: number;
  remainingCostBasisUsd: number;
  averageEntryPrice: number | null;
  totalRealizedPnlUsd: number;
  sells: SellResult[];
}

export function computeWeightedAverageCostBasis(
  events: CostBasisEvent[]
): CostBasisResult {
  const chronological = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let quantity = 0;
  let costBasisUsd = 0;
  let totalRealizedPnlUsd = 0;
  const sells: SellResult[] = [];

  for (const event of chronological) {
    if (event.amount <= 0) continue;

    if (event.type === "BUY") {
      quantity += event.amount;
      costBasisUsd += event.usdValue;
      continue;
    }

    // SELL
    const avgEntryPrice = quantity > 0 ? costBasisUsd / quantity : 0;
    const costBasisComplete = event.amount <= quantity;
    const amountCovered = Math.min(event.amount, quantity);
    const costOfSoldUsd = avgEntryPrice * amountCovered;

    quantity = Math.max(0, quantity - event.amount);
    costBasisUsd = Math.max(0, costBasisUsd - costOfSoldUsd);

    const realizedPnlUsd = event.usdValue - costOfSoldUsd;
    totalRealizedPnlUsd += realizedPnlUsd;

    sells.push({
      timestamp: event.timestamp,
      amountSold: event.amount,
      proceedsUsd: event.usdValue,
      costOfSoldUsd,
      realizedPnlUsd,
      costBasisComplete,
    });
  }

  return {
    remainingQuantity: quantity,
    remainingCostBasisUsd: costBasisUsd,
    averageEntryPrice: quantity > 0 ? costBasisUsd / quantity : null,
    totalRealizedPnlUsd,
    sells,
  };
}
