import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ValidationFilters } from "@/components/validation/ValidationFilters";
import { CoverageBanner } from "@/components/validation/CoverageBanner";
import { SignalQualityTable } from "@/components/validation/SignalQualityTable";
import { StrategyDecisionTable } from "@/components/validation/StrategyDecisionTable";
import { getSignalQualityData, getStrategyDecisionBreakdown } from "@/lib/validation/dashboard-data";
import { isSupabaseConfigured } from "@/lib/env";

// Every number here is derived from already-persisted Supabase data (events,
// evaluations, observations) — never a live Birdeye/Helius call from a page
// view, matching the rest of the app's convention. Must stay dynamic so a
// fresh tick's new events/observations aren't masked by a stale prerender.
export const dynamic = "force-dynamic";

function parseIntParam(params: Record<string, string | string[] | undefined>, key: string, fallback: number): number {
  const raw = Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export default async function ValidationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div>
        <PageHeader title="Signal Validation" description="Does Smart Money convergence actually predict price?" />
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Supabase isn&apos;t configured, so there&apos;s no signal history to analyze. See /settings.
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const minWallets = parseIntParam(params, "minWallets", 2);
  const minAvgSmartScore = parseIntParam(params, "minAvgSmartScore", 0);

  const [signalQuality, strategyBreakdown] = await Promise.all([
    getSignalQualityData({ minWallets, minAvgSmartScore }),
    getStrategyDecisionBreakdown(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signal Validation"
        description="Does Smart Money convergence actually predict price? Research view, separate from whether any Demo strategy happened to be profitable."
      />

      <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-xs text-accent">
        Observations only accumulate when a Demo tick (&quot;Evaluate Signals Now&quot;)
        happens to run near a given horizon — there&apos;s no background scheduler while
        this app is localhost-only. Short horizons (5m/15m) will read mostly
        &quot;unavailable&quot; under realistic manual-click cadence — that&apos;s honest
        behavior, not a malfunction. Coverage improves automatically once this is deployed
        and ticks can run on a schedule (see supabase/CRON.md).
      </div>

      <ValidationFilters minWallets={minWallets} minAvgSmartScore={minAvgSmartScore} />

      {signalQuality.eventCount === 0 ? (
        <EmptyState
          title="No convergence events recorded yet with these filters"
          description="Events are recorded the moment any Demo strategy's tick detects a qualifying convergence signal — run 'Evaluate Signals Now' on a strategy from /demo, or widen the filters above."
        />
      ) : (
        <>
          <div>
            <div className="mb-2 text-sm font-medium text-foreground">
              Signal Quality <span className="font-normal text-muted">({signalQuality.eventCount} events)</span>
            </div>
            <p className="mb-2 text-xs text-muted">
              Computed from convergence_events directly — deduplicated by construction, one
              row per real-world occurrence regardless of how many strategies independently
              evaluated it. Headline return/win-rate figures use on-time-resolved
              observations only (see coverage below for early/unavailable counts).
            </p>
            <CoverageBanner horizons={signalQuality.horizons} />
            <div className="mt-3">
              <SignalQualityTable horizons={signalQuality.horizons} />
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-foreground">Strategy Decisions</div>
            <p className="mb-2 text-xs text-muted">
              A different question: given each strategy&apos;s own capital/risk rules, what
              did it actually do about the signals it saw. A high &quot;max positions&quot; or
              &quot;insufficient cash&quot; count doesn&apos;t mean the signal was bad — it
              means the strategy couldn&apos;t act on it.
            </p>
            {strategyBreakdown.length === 0 ? (
              <EmptyState title="No strategy evaluations yet" description="Create a Demo strategy and run a tick from /demo." />
            ) : (
              <StrategyDecisionTable rows={strategyBreakdown} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
