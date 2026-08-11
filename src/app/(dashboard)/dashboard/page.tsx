import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LeaderboardTable } from "@/components/dashboard/LeaderboardTable";
import { getLeaderboard } from "@/lib/discovery/leaderboard";
import { isSupabaseConfigured } from "@/lib/env";

// The leaderboard changes with every discovery/analysis run — Next's static
// analysis doesn't detect the Supabase client's internal fetch as a reason to
// stay dynamic, so without this the page would prerender once at build time
// and silently serve stale data forever after.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const rows = await getLeaderboard("90D", 10);

  return (
    <div>
      <PageHeader
        title="Leaderboard"
        description="Top-ranked Solana wallets by WalletRadar Smart Score (90D, Recommended preset)."
      />
      {rows.length > 0 ? (
        <LeaderboardTable rows={rows} />
      ) : (
        <EmptyState
          title="Leaderboard not populated yet"
          description={
            isSupabaseConfigured()
              ? "No wallets have been scored yet. Go to Discover and run a Discovery Scan, then Analyze Pending Candidates — or analyze a wallet manually."
              : "Supabase isn't configured, so nothing is being persisted yet. See /settings for setup steps."
          }
        />
      )}
    </div>
  );
}
