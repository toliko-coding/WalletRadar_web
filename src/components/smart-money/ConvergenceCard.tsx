import Link from "next/link";
import type { ConvergenceSignal } from "@/lib/smart-money/detect-convergence";
import { SmartScoreBadge } from "@/components/ui/SmartScoreBadge";

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ConvergenceCard({ signal }: { signal: ConvergenceSignal }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
              Convergence
            </span>
            <span className="font-mono text-sm text-foreground">
              {signal.tokenSymbol ?? shortAddress(signal.tokenMint)}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {signal.walletCount} tracked wallets bought this token within the detection window
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          <div>
            First buy: <span className="text-foreground">{timeAgo(signal.firstBuyAt)}</span>
          </div>
          <div>
            Latest buy: <span className="text-foreground">{timeAgo(signal.latestBuyAt)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="text-xs">
          <div className="text-muted">Total Buy Volume</div>
          <div className="mt-0.5 font-medium text-foreground">{formatUsd(signal.totalBuyVolumeUsd)}</div>
        </div>
        <div className="text-xs">
          <div className="text-muted">Average Smart Score</div>
          <div className="mt-0.5">
            {signal.averageSmartScore !== null ? (
              <SmartScoreBadge score={Math.round(signal.averageSmartScore)} size="sm" />
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="text-xs sm:col-span-2">
          <div className="text-muted">
            Price / market cap / liquidity — not fetched live to conserve API quota
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr className="border-b border-border bg-background text-left text-muted">
              <th className="px-3 py-1.5 font-medium">Wallet</th>
              <th className="px-3 py-1.5 font-medium">Smart Score</th>
              <th className="px-3 py-1.5 font-medium">Buy Amount</th>
              <th className="px-3 py-1.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {signal.wallets.map((w) => (
              <tr key={w.walletAddress} className="border-b border-border last:border-b-0">
                <td className="px-3 py-1.5 font-mono">
                  <Link href={`/wallet/${w.walletAddress}`} className="text-accent hover:underline">
                    {shortAddress(w.walletAddress)}
                  </Link>
                </td>
                <td className="px-3 py-1.5">{w.smartScore ?? "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{formatUsd(w.usdValue)}</td>
                <td className="px-3 py-1.5 text-muted">{timeAgo(w.occurredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
