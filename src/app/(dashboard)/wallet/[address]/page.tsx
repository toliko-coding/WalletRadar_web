import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { WalletAnalysisView } from "@/components/wallet/WalletAnalysisView";
import { analyzeWallet, isValidSolanaAddress } from "@/lib/analysis/analyze-wallet";
import { isBirdeyeConfigured, isHeliusConfigured } from "@/lib/env";

export default async function WalletDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) notFound();

  if (!isBirdeyeConfigured() || !isHeliusConfigured()) {
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

  const analysis = await analyzeWallet(address);

  return (
    <div>
      <PageHeader
        title="Wallet Analysis"
        description="Real data from Birdeye and Helius. Estimated figures are tagged — see reliability labels."
      />
      <WalletAnalysisView analysis={analysis} />
    </div>
  );
}
