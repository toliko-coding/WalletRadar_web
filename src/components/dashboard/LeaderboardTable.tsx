import Link from "next/link";
import type { LeaderboardRow } from "@/lib/discovery/leaderboard";
import { SmartScoreBadge } from "@/components/ui/SmartScoreBadge";
import { PnlValue } from "@/components/ui/PnlValue";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { ReliabilityTag } from "@/components/ui/ReliabilityTag";

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatUsd(value: number | null): string {
  return value === null ? "—" : `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Rank</th>
            <th className="px-3 py-2 font-medium">Wallet</th>
            <th className="px-3 py-2 font-medium">Smart Score</th>
            <th className="px-3 py-2 font-medium">Realized PnL</th>
            <th className="px-3 py-2 font-medium">ROI</th>
            <th className="px-3 py-2 font-medium">Win Rate</th>
            <th className="px-3 py-2 font-medium">Trades</th>
            <th className="px-3 py-2 font-medium">Volume</th>
            <th className="px-3 py-2 font-medium">Drawdown</th>
            <th className="px-3 py-2 font-medium">Risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.walletAddress} className="border-b border-border last:border-b-0 hover:bg-surface-raised">
              <td className="px-3 py-2 text-muted">#{i + 1}</td>
              <td className="px-3 py-2 font-mono text-xs">
                <Link href={`/wallet/${row.walletAddress}`} className="text-accent hover:underline">
                  {shortAddress(row.walletAddress)}
                </Link>
              </td>
              <td className="px-3 py-2">
                <SmartScoreBadge score={row.smartScore} size="sm" />
              </td>
              <td className="px-3 py-2">
                <PnlValue pnl={{ value: row.realizedPnlUsd, reliability: row.realizedPnlReliability }} />
              </td>
              <td className="px-3 py-2 tabular-nums">{formatPct(row.roiPct)}</td>
              <td className="px-3 py-2 tabular-nums">{formatPct(row.winRatePct)}</td>
              <td className="px-3 py-2 tabular-nums">{row.tradeCount.toLocaleString()}</td>
              <td className="px-3 py-2 tabular-nums">{formatUsd(row.volumeUsd)}</td>
              <td className="px-3 py-2 tabular-nums">
                {row.maxDrawdownPct !== null ? `-${row.maxDrawdownPct.toFixed(1)}%` : "—"}
                <ReliabilityTag reliability={row.maxDrawdownReliability} />
              </td>
              <td className="px-3 py-2">{row.riskLevel ? <RiskBadge level={row.riskLevel} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
