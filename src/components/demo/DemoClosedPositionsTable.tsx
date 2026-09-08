import type { DemoPosition } from "@/lib/demo/types";

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatDuration(startIso: string, endIso: string): string {
  const hours = (new Date(endIso).getTime() - new Date(startIso).getTime()) / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

const EXIT_RULE_LABEL: Record<string, string> = {
  STOP_LOSS: "Stop Loss",
  TAKE_PROFIT: "Take Profit",
  MAX_HOLDING_PERIOD: "Max Hold",
};

/**
 * Closed positions carry information a flat trades feed doesn't: which exit
 * rule actually fired (stop loss vs. take profit vs. timing out at max hold)
 * and how long the position was held — both essential for judging whether a
 * strategy's exit configuration itself is well-tuned, not just its entries.
 */
export function DemoClosedPositionsTable({ positions }: { positions: DemoPosition[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
        No closed positions yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Token</th>
            <th className="px-3 py-2 font-medium">Entry</th>
            <th className="px-3 py-2 font-medium">Exit</th>
            <th className="px-3 py-2 font-medium">Held</th>
            <th className="px-3 py-2 font-medium">Exit Reason</th>
            <th className="px-3 py-2 font-medium">Fees</th>
            <th className="px-3 py-2 font-medium">Net PnL</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2 font-mono text-xs">{p.tokenSymbol ?? shortAddress(p.tokenMint)}</td>
              <td className="px-3 py-2 tabular-nums">${p.entryPrice.toPrecision(4)}</td>
              <td className="px-3 py-2 tabular-nums">{p.exitPrice !== null ? `$${p.exitPrice.toPrecision(4)}` : "—"}</td>
              <td className="px-3 py-2 text-xs text-muted">
                {p.exitTime ? formatDuration(p.entryTime, p.exitTime) : "—"}
              </td>
              <td className="px-3 py-2 text-xs text-muted">{p.exitRule ? (EXIT_RULE_LABEL[p.exitRule] ?? p.exitRule) : "—"}</td>
              <td className="px-3 py-2 tabular-nums text-xs text-muted">${p.feesUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              <td className="px-3 py-2 tabular-nums">
                <span className={(p.netPnlUsd ?? 0) >= 0 ? "text-profit" : "text-loss"}>{formatUsd(p.netPnlUsd)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
