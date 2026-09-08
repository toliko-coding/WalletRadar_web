import { isBirdeyeConfigured, isHeliusConfigured, isSupabaseConfigured } from "@/lib/env";
import { WalletSearchBox } from "@/components/layout/WalletSearchBox";

function StatusPill({ label, connected }: { label: string; connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-[11px] text-muted">
      <span
        className={
          "h-1.5 w-1.5 rounded-full " + (connected ? "bg-profit" : "bg-warning")
        }
      />
      {label}
    </span>
  );
}

export function TopBar() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/80 px-4 py-3 sm:px-6">
      <div className="hidden text-sm text-muted sm:block">
        Solana wallet intelligence &amp; paper-trading research
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WalletSearchBox />
        <StatusPill label="Birdeye" connected={isBirdeyeConfigured()} />
        <StatusPill label="Helius" connected={isHeliusConfigured()} />
        <StatusPill label="Supabase" connected={isSupabaseConfigured()} />
      </div>
    </header>
  );
}
