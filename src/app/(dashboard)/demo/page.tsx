import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function DemoPage() {
  return (
    <div>
      <PageHeader
        title="Demo / Paper Trading"
        description="Fully virtual — no real funds or on-chain transactions are ever involved."
      />
      <EmptyState
        title="Paper trading engine not built yet"
        description="The Demo Portfolio (Phase 1I) simulates following WalletRadar signals forward in time, and depends on Smart Money convergence detection existing first. Nothing here will ever execute a real trade."
      />
    </div>
  );
}
