import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { WalletAnalysisView } from "@/components/wallet/WalletAnalysisView";
import { RefreshAnalysisButton } from "@/components/wallet/RefreshAnalysisButton";
import { SmartScoreHistoryChart } from "@/components/wallet/SmartScoreHistoryChart";
import { analyzeWallet, isValidSolanaAddress } from "@/lib/analysis/analyze-wallet";
import { getCachedAnalysis } from "@/lib/analysis/cached-analysis";
import { getScoreHistory } from "@/lib/analysis/score-history";
import { isBirdeyeConfigured, isHeliusConfigured } from "@/lib/env";

// Reads cached Supabase data by default (see getCachedAnalysis) — must stay
// dynamic so a Refresh click's new data (and a first-ever cold analysis)
// isn't masked by a stale prerendered build.
export const dynamic = "force-dynamic";

export default async function WalletDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) notFound();

  const cached = await getCachedAnalysis(address);

  if (!cached && (!isBirdeyeConfigured() || !isHeliusConfigured())) {
    return (
      <div>
        <PageHeader title="Wallet Analysis" />
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Birdeye and Helius API keys aren&apos;t configured yet. Add them to .env.local
          (see .env.example) to analyze real wallets.
        </div>
      </div>
    );
  }

  // Cached data is served as-is, however old — viewing a wallet must never
  // silently trigger a live Birdeye/Helius call (and burn API quota). Only a
  // never-before-seen wallet forces one, since there's nothing to read yet.
  const analysis = cached ?? (await analyzeWallet(address));
  const scoreHistory = await getScoreHistory(address);

  return (
    <div>
      <PageHeader
        title="Wallet Analysis"
        description="Real data from Birdeye and Helius. Estimated figures are tagged — see reliability labels."
        actions={<RefreshAnalysisButton walletAddress={address} analyzedAt={analysis.analyzedAt} />}
      />
      {scoreHistory.length >= 2 ? (
        <div className="mb-6">
          <div className="mb-2 text-sm font-medium text-foreground">Smart Score History</div>
          <SmartScoreHistoryChart points={scoreHistory} />
        </div>
      ) : null}
      <WalletAnalysisView analysis={analysis} />
    </div>
  );
}
