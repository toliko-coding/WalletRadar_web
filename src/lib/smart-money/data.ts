import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { detectConvergenceSignals, type ConvergenceSignal, type TrackedBuy } from "./detect-convergence";

export interface SmartMoneyCriteria {
  minWallets: number;
  windowMinutes: number;
  minSmartScore: number;
  minCombinedUsd?: number;
  lookbackHours: number;
}

export const DEFAULT_SMART_MONEY_CRITERIA: SmartMoneyCriteria = {
  minWallets: 2,
  windowMinutes: 180,
  minSmartScore: 0,
  lookbackHours: 72,
};

/**
 * "Tracked" here means any wallet whose latest 90D analysis cleared
 * minSmartScore — not a curated, continuously-monitored Top-N set, since
 * that requires the real-time webhook monitoring of Phase 1G, which doesn't
 * exist yet. This is a smaller, honest claim: convergence among wallets
 * we've actually scored, computed retrospectively from stored trades.
 */
export async function getConvergenceSignals(criteria: SmartMoneyCriteria): Promise<ConvergenceSignal[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];

  const { data: trackedWallets } = await supabase
    .from("wallet_metrics")
    .select("wallet_address, smart_score")
    .eq("window_label", "90D")
    .gte("smart_score", criteria.minSmartScore);

  const scoreByWallet = new Map<string, number>(
    (trackedWallets ?? []).map((w) => [w.wallet_address as string, w.smart_score as number])
  );
  const addresses = [...scoreByWallet.keys()];
  if (addresses.length === 0) return [];

  const cutoff = new Date(Date.now() - criteria.lookbackHours * 60 * 60 * 1000).toISOString();
  const { data: trades } = await supabase
    .from("wallet_trades")
    .select("wallet_address, token_mint, token_symbol, occurred_at, usd_value")
    .in("wallet_address", addresses)
    .eq("type", "DEX_SWAP_BUY")
    .gte("occurred_at", cutoff);

  const buys: TrackedBuy[] = (trades ?? []).map((t) => ({
    walletAddress: t.wallet_address as string,
    tokenMint: t.token_mint as string,
    tokenSymbol: t.token_symbol as string | null,
    occurredAt: t.occurred_at as string,
    usdValue: t.usd_value as number | null,
    smartScore: scoreByWallet.get(t.wallet_address as string) ?? null,
  }));

  return detectConvergenceSignals(buys, {
    minWallets: criteria.minWallets,
    windowMinutes: criteria.windowMinutes,
    minCombinedUsd: criteria.minCombinedUsd,
  });
}
