import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function SmartMoneyPage() {
  return (
    <div>
      <PageHeader
        title="Smart Money Activity"
        description="What multiple high-quality wallets are buying right now."
      />
      <EmptyState
        title="Convergence detection not built yet"
        description="This page requires near-real-time monitoring of the Top-N wallet set (Phase 1G) and convergence detection (Phase 1H), which come after wallet discovery is in place."
      />
    </div>
  );
}
