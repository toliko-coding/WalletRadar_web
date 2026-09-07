import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SmartMoneyFilters } from "@/components/smart-money/SmartMoneyFilters";
import { ConvergenceCard } from "@/components/smart-money/ConvergenceCard";
import { getConvergenceSignals, DEFAULT_SMART_MONEY_CRITERIA, type SmartMoneyCriteria } from "@/lib/smart-money/data";
import { isSupabaseConfigured } from "@/lib/env";

// Convergence is computed fresh from wallet_trades on every request — must
// stay dynamic or it would prerender once and never reflect new trades.
export const dynamic = "force-dynamic";

function parseCriteria(params: Record<string, string | string[] | undefined>): SmartMoneyCriteria {
  const num = (key: string, fallback: number) => {
    const raw = Array.isArray(params[key]) ? params[key]?.[0] : params[key];
    const n = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    minWallets: num("minWallets", DEFAULT_SMART_MONEY_CRITERIA.minWallets),
    windowMinutes: num("windowMinutes", DEFAULT_SMART_MONEY_CRITERIA.windowMinutes),
    minSmartScore: num("minSmartScore", DEFAULT_SMART_MONEY_CRITERIA.minSmartScore),
    minCombinedUsd: params.minCombinedUsd ? num("minCombinedUsd", 0) || undefined : undefined,
    lookbackHours: num("lookbackHours", DEFAULT_SMART_MONEY_CRITERIA.lookbackHours),
  };
}

export default async function SmartMoneyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const criteria = parseCriteria(params);
  const signals = await getConvergenceSignals(criteria);

  return (
    <div>
      <PageHeader
        title="Smart Money Activity"
        description="What multiple tracked wallets are buying, computed from already-analyzed trade history — not live real-time monitoring yet (Phase 1G)."
      />
      <SmartMoneyFilters criteria={criteria} />
      {signals.length > 0 ? (
        <div className="space-y-4">
          {signals.map((signal) => (
            <ConvergenceCard key={signal.tokenMint} signal={signal} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No convergence detected with these filters"
          description={
            isSupabaseConfigured()
              ? "Try lowering the minimum wallet count, widening the time window, or increasing the lookback period. This only sees wallets that have already been analyzed (Discover → Run Discovery Scan + Analyze Pending Candidates) and their stored buy history."
              : "Supabase isn't configured, so there's no trade history to analyze. See /settings."
          }
        />
      )}
    </div>
  );
}
