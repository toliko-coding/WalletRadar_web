import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Leaderboard"
        description="Top-ranked Solana wallets by WalletRadar Smart Score."
      />
      <EmptyState
        title="Leaderboard not populated yet"
        description="The wallet discovery engine and scheduled scoring runs (Phase 1C–1F) haven't been built yet. Use Discover → Manual Wallet Analyzer to score an individual wallet in the meantime."
      />
    </div>
  );
}
