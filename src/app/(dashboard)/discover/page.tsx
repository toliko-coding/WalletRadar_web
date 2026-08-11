import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { WalletAnalyzerForm } from "@/components/wallet/WalletAnalyzerForm";
import { DiscoveryActions } from "@/components/discover/DiscoveryActions";
import { getDiscoveryStats } from "@/lib/discovery/stats";
import { isSupabaseConfigured } from "@/lib/env";

// Same reasoning as /dashboard: these stats and job-run timestamps change
// on every trigger, so this must never be statically prerendered.
export const dynamic = "force-dynamic";

function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function DiscoverPage() {
  const stats = await getDiscoveryStats();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover"
        description={
          isSupabaseConfigured()
            ? "Automated wallet discovery — trending tokens' top traders, scored via the Recommended preset."
            : "Supabase isn't configured, so discovery stats below can't persist. See /settings."
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Candidate Wallets" value={formatCount(stats.candidateWallets)} />
        <MetricCard label="Analyzed" value={formatCount(stats.analyzed)} />
        <MetricCard label="Eligible" value={formatCount(stats.eligible)} />
        <MetricCard label="Top Tracked" value={formatCount(stats.topTracked)} />
        <MetricCard label="Last Discovery Scan" value={formatTimeAgo(stats.lastDiscoveryScanAt)} />
        <MetricCard label="Last Analysis Run" value={formatTimeAgo(stats.lastAnalysisRunAt)} />
      </div>

      <DiscoveryActions />

      <WalletAnalyzerForm />
    </div>
  );
}
