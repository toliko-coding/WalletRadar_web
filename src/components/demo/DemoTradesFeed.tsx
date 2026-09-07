import type { DemoTrade } from "@/lib/demo/types";

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function DemoTradesFeed({ trades }: { trades: DemoTrade[] }) {
  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
        No demo trades yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {trades.map((t) => (
        <div key={t.id} className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${t.action === "BUY" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}
              >
                {t.action === "BUY" ? "PAPER BUY" : "PAPER SELL"}
              </span>
              <span className="font-mono text-xs">{t.tokenSymbol ?? shortAddress(t.tokenMint)}</span>
            </div>
            <span className="text-xs text-muted">{new Date(t.executedAt).toLocaleString()}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-4 text-xs text-muted">
            <span>
              Amount: <span className="text-foreground">${t.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </span>
            <span>
              Execution: <span className="text-foreground">${t.executionPrice.toPrecision(4)}</span>
            </span>
            <span>
              Slippage applied: <span className="text-foreground">{t.simulatedSlippagePct}%</span>
            </span>
            {t.action === "SELL" ? (
              <span>
                Net PnL: <span className={(t.netPnlUsd ?? 0) >= 0 ? "text-profit" : "text-loss"}>{formatUsd(t.netPnlUsd)}</span>
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
