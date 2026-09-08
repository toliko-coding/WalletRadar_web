import Link from "next/link";
import type { StrategyComparisonRow } from "@/lib/demo/comparison";

function formatUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/** §38 — compares strategies with different discovery/convergence criteria side by side. */
export function StrategyComparisonTable({ rows }: { rows: StrategyComparisonRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Strategy</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="px-3 py-2 font-medium">Total PnL</th>
            <th className="px-3 py-2 font-medium">ROI</th>
            <th className="px-3 py-2 font-medium">Alpha vs SOL</th>
            <th className="px-3 py-2 font-medium">Max Drawdown</th>
            <th className="px-3 py-2 font-medium">Win Rate</th>
            <th className="px-3 py-2 font-medium">Profit Factor</th>
            <th className="px-3 py-2 font-medium">Trades</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const alphaVsSol = row.solRoiPct !== null ? row.roiPct - row.solRoiPct : null;
            return (
              <tr key={row.strategy.id} className="border-b border-border last:border-b-0 hover:bg-surface-raised">
                <td className="px-3 py-2">
                  <Link href={`/demo?strategy=${row.strategy.id}`} className="text-accent hover:underline">
                    {row.strategy.name}
                  </Link>
                  {row.strategy.status === "PAUSED" ? <span className="ml-1.5 text-xs text-muted">(paused)</span> : null}
                </td>
                <td className="px-3 py-2 tabular-nums">${row.currentValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td className={`px-3 py-2 tabular-nums ${row.totalPnlUsd >= 0 ? "text-profit" : "text-loss"}`}>
                  {formatUsd(row.totalPnlUsd)}
                </td>
                <td className={`px-3 py-2 tabular-nums ${row.roiPct >= 0 ? "text-profit" : "text-loss"}`}>{formatPct(row.roiPct)}</td>
                <td className={`px-3 py-2 tabular-nums ${alphaVsSol !== null && alphaVsSol >= 0 ? "text-profit" : alphaVsSol !== null ? "text-loss" : "text-muted"}`}>
                  {formatPct(alphaVsSol)}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted">
                  {row.maxDrawdownPct !== null ? `${(-row.maxDrawdownPct).toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatPct(row.winRatePct)}</td>
                <td className="px-3 py-2 tabular-nums">{row.profitFactor !== null ? row.profitFactor.toFixed(2) : "—"}</td>
                <td className="px-3 py-2 tabular-nums text-muted">
                  {row.closedTradeCount} closed / {row.openPositionCount} open
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
