import type { DemoPosition } from "@/lib/demo/types";

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function DemoPositionsTable({ positions }: { positions: DemoPosition[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
        No open positions.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Token</th>
            <th className="px-3 py-2 font-medium">Entry Price</th>
            <th className="px-3 py-2 font-medium">Size</th>
            <th className="px-3 py-2 font-medium">Stop Loss</th>
            <th className="px-3 py-2 font-medium">Take Profit</th>
            <th className="px-3 py-2 font-medium">Age</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2 font-mono text-xs">{p.tokenSymbol ?? shortAddress(p.tokenMint)}</td>
              <td className="px-3 py-2 tabular-nums">${p.entryPrice.toPrecision(4)}</td>
              <td className="px-3 py-2 tabular-nums">${p.positionSizeUsd.toLocaleString()}</td>
              <td className="px-3 py-2 tabular-nums text-muted">{p.stopLossPrice !== null ? `$${p.stopLossPrice.toPrecision(4)}` : "—"}</td>
              <td className="px-3 py-2 tabular-nums text-muted">{p.takeProfitPrice !== null ? `$${p.takeProfitPrice.toPrecision(4)}` : "—"}</td>
              <td className="px-3 py-2 text-xs text-muted">{formatAge(p.entryTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
