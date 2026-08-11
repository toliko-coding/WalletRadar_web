import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LeaderboardTable } from "@/components/dashboard/LeaderboardTable";
import { FiltersBar } from "@/components/dashboard/FiltersBar";
import { getLeaderboard } from "@/lib/discovery/leaderboard";
import { resolveFilterCriteria } from "@/lib/discovery/presets";
import { isSupabaseConfigured } from "@/lib/env";

// The leaderboard changes with every discovery/analysis run (and every
// filter change) — Next's static analysis doesn't detect the Supabase
// client's internal fetch as a reason to stay dynamic, so without this the
// page would prerender once at build time and silently serve stale data.
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const windowLabel = (Array.isArray(params.window) ? params.window[0] : params.window) ?? "90D";
  const { presetId, isCustom, criteria } = resolveFilterCriteria(params);

  const rows = await getLeaderboard(windowLabel, criteria);

  return (
    <div>
      <PageHeader
        title="Leaderboard"
        description="Top-ranked Solana wallets by WalletRadar Smart Score — filterable by preset or custom criteria."
      />
      <FiltersBar presetId={presetId} isCustom={isCustom} criteria={criteria} windowLabel={windowLabel} />
      {rows.length > 0 ? (
        <LeaderboardTable rows={rows} />
      ) : (
        <EmptyState
          title="No wallets match these filters"
          description={
            isSupabaseConfigured()
              ? "Try a looser preset (Aggressive or Recently Hot), or go to Discover and run a Discovery Scan + Analyze Pending Candidates to score more wallets."
              : "Supabase isn't configured, so nothing is being persisted yet. See /settings for setup steps."
          }
        />
      )}
    </div>
  );
}
