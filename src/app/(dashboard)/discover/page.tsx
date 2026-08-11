import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { WalletAnalyzerForm } from "@/components/wallet/WalletAnalyzerForm";

export default function DiscoverPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover"
        description="Automated wallet discovery (Phase 1C) hasn't run yet — these are placeholders."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Candidate Wallets" value="—" />
        <MetricCard label="Analyzed" value="—" />
        <MetricCard label="Eligible" value="—" />
        <MetricCard label="Recommended" value="—" />
        <MetricCard label="Top Tracked" value="—" />
        <MetricCard label="Last Full Scan" value="Never" />
      </div>

      <WalletAnalyzerForm />
    </div>
  );
}
