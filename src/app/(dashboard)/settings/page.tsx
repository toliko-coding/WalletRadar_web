import { PageHeader } from "@/components/ui/PageHeader";
import { ProviderUsagePanel } from "@/components/settings/ProviderUsagePanel";
import { isBirdeyeConfigured, isHeliusConfigured, isSupabaseConfigured } from "@/lib/env";
import { getTodayProviderUsage } from "@/lib/telemetry/provider-usage-data";

// Provider usage counters change on every Birdeye/Helius call — must stay
// dynamic or a prerendered build would show stale/zero counts forever.
export const dynamic = "force-dynamic";

function Row({ label, connected, hint }: { label: string; connected: boolean; hint: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0">
      <div>
        <div className="text-sm text-foreground">{label}</div>
        <div className="text-xs text-muted">{hint}</div>
      </div>
      <span
        className={
          "rounded px-2 py-0.5 text-xs font-medium " +
          (connected ? "bg-profit/15 text-profit" : "bg-warning/15 text-warning")
        }
      >
        {connected ? "Configured" : "Not configured"}
      </span>
    </div>
  );
}

export default async function SettingsPage() {
  const usage = await getTodayProviderUsage();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Provider connectivity and configuration. Filter presets, watchlists, and account settings arrive with auth in Phase 2."
      />
      <div className="rounded-lg border border-border bg-surface">
        <Row
          label="Birdeye"
          connected={isBirdeyeConfigured()}
          hint="Wallet PnL, portfolio, and market data. Set BIRDEYE_API_KEY in .env.local."
        />
        <Row
          label="Helius"
          connected={isHeliusConfigured()}
          hint="Enhanced transaction parsing and (later) real-time webhooks. Set HELIUS_API_KEY in .env.local."
        />
        <Row
          label="Supabase"
          connected={isSupabaseConfigured()}
          hint="Persistence for candidate wallets, metrics, and job history. Create a project, run supabase/migrations, and set the Supabase env vars."
        />
      </div>

      <ProviderUsagePanel usage={usage} />
    </div>
  );
}
