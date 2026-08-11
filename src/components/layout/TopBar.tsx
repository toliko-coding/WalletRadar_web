import { isBirdeyeConfigured, isHeliusConfigured, isSupabaseConfigured } from "@/lib/env";

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
    <header className="flex items-center justify-between border-b border-border bg-background/80 px-6 py-3">
      <div className="text-sm text-muted">
        Solana wallet intelligence &amp; paper-trading research
      </div>
      <div className="flex items-center gap-2">
        <StatusPill label="Birdeye" connected={isBirdeyeConfigured()} />
        <StatusPill label="Helius" connected={isHeliusConfigured()} />
        <StatusPill label="Supabase" connected={isSupabaseConfigured()} />
      </div>
    </header>
  );
}
