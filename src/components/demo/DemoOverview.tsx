import { MetricCard } from "@/components/ui/MetricCard";
import type { DemoAccount, DemoStrategy } from "@/lib/demo/types";
import type { BenchmarkComparison } from "@/lib/demo/benchmarks";

function formatUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function DemoOverview({
  strategy,
  account,
  totalValueUsd,
  openPositionValueUsd,
  realizedPnlUsd,
  unrealizedPnlUsd,
  totalPnlUsd,
  roiPct,
  benchmark,
}: {
  strategy: DemoStrategy;
  account: DemoAccount;
  totalValueUsd: number;
  openPositionValueUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  roiPct: number;
  benchmark: BenchmarkComparison;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Starting Balance" value={`$${strategy.startingCapitalUsd.toLocaleString()}`} />
        <MetricCard label="Current Value" value={`$${totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <MetricCard label="Cash" value={`$${account.cashBalanceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <MetricCard label="Open Position Value" value={`$${openPositionValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <MetricCard label="Realized PnL" value={formatUsd(realizedPnlUsd)} tone={realizedPnlUsd >= 0 ? "profit" : "loss"} />
        <MetricCard label="Unrealized PnL" value={formatUsd(unrealizedPnlUsd)} tone={unrealizedPnlUsd >= 0 ? "profit" : "loss"} />
        <MetricCard label="Total PnL" value={formatUsd(totalPnlUsd)} tone={totalPnlUsd >= 0 ? "profit" : "loss"} />
        <MetricCard label="ROI" value={formatPct(roiPct)} tone={roiPct >= 0 ? "profit" : "loss"} />
      </div>

      <div className="rounded-lg border border-border bg-surface px-4 py-3">
        <div className="mb-2 text-xs font-medium text-foreground">Since Strategy Started</div>
        <div className="flex flex-wrap gap-6 text-xs">
          <div>
            <div className="text-muted">WalletRadar</div>
            <div className={roiPct >= 0 ? "text-profit" : "text-loss"}>{formatPct(roiPct)}</div>
          </div>
          <div>
            <div className="text-muted">SOL</div>
            <div>{formatPct(benchmark.solRoiPct)}</div>
          </div>
          <div>
            <div className="text-muted">BTC</div>
            <div title="BTC isn't a Solana token — needs a separate price source not yet integrated">not tracked</div>
          </div>
          {benchmark.solRoiPct !== null ? (
            <div>
              <div className="text-muted">Excess vs SOL</div>
              <div className={roiPct - benchmark.solRoiPct >= 0 ? "text-profit" : "text-loss"}>
                {formatPct(roiPct - benchmark.solRoiPct)}
              </div>
            </div>
          ) : (
            <div className="text-muted self-end">Needs 2+ ticks to compare against SOL</div>
          )}
        </div>
      </div>
    </div>
  );
}
