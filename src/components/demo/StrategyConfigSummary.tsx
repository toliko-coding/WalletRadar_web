import type { DemoStrategy } from "@/lib/demo/types";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

/** Surfaces a strategy's config after creation — previously only visible by checking Supabase directly. */
export function StrategyConfigSummary({ strategy }: { strategy: DemoStrategy }) {
  const hasRiskFilters =
    strategy.minTokenLiquidityUsd !== null || strategy.minMarketCapUsd !== null || strategy.maxMarketCapUsd !== null;

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="mb-2 text-xs font-medium text-foreground">Strategy Configuration</div>
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Field label="Signal Criteria" value={`${strategy.minWalletsRequired}+ wallets, Smart Score ≥${strategy.minSmartScore}`} />
        <Field label="Signal Window" value={`${strategy.signalWindowMinutes} min`} />
        <Field label="Position Size" value={`$${strategy.virtualBuySizeUsd.toLocaleString()}`} />
        <Field label="Max Positions" value={`${strategy.maxOpenPositions} (max ${strategy.maxAllocationPctPerToken}%/token)`} />
        <Field label="Stop Loss" value={strategy.stopLossPct !== null ? `-${strategy.stopLossPct}%` : "None"} />
        <Field label="Take Profit" value={strategy.takeProfitPct !== null ? `+${strategy.takeProfitPct}%` : "None"} />
        <Field label="Max Hold Period" value={strategy.maxPositionAgeHours !== null ? `${strategy.maxPositionAgeHours}h` : "None"} />
        <Field label="Slippage / Fee" value={`${strategy.simulatedSlippagePct}% / ${strategy.feePct}%`} />
      </div>
      {hasRiskFilters ? (
        <div className="mt-3 border-t border-border pt-3 text-xs">
          <div className="text-muted">Token Risk Filters</div>
          <div className="mt-0.5 text-foreground">
            {[
              strategy.minTokenLiquidityUsd !== null ? `Min liquidity $${strategy.minTokenLiquidityUsd.toLocaleString()}` : null,
              strategy.minMarketCapUsd !== null ? `Min mcap $${strategy.minMarketCapUsd.toLocaleString()}` : null,
              strategy.maxMarketCapUsd !== null ? `Max mcap $${strategy.maxMarketCapUsd.toLocaleString()}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      ) : null}
    </div>
  );
}
