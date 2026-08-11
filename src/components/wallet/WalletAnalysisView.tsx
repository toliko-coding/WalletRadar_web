import type { WalletAnalysis } from "@/types/domain";
import { MetricCard } from "@/components/ui/MetricCard";
import { PnlValue } from "@/components/ui/PnlValue";
import { SmartScoreBadge } from "@/components/ui/SmartScoreBadge";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { ReliabilityTag } from "@/components/ui/ReliabilityTag";
import { TransactionTypeBadge } from "@/components/ui/TransactionTypeBadge";
import { CopyButton } from "@/components/wallet/CopyButton";

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletAnalysisView({ analysis }: { analysis: WalletAnalysis }) {
  const { metrics, smartScore, positions, trades } = analysis;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-foreground">{analysis.walletAddress}</span>
            <CopyButton value={analysis.walletAddress} />
            <a
              href={`https://solscan.io/account/${analysis.walletAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline"
            >
              View on Solscan
            </a>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <RiskBadge level={metrics.riskLevel} />
            <span>
              {analysis.eligible ? "Meets Recommended criteria" : "Does not meet Recommended criteria"}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">WalletRadar Smart Score</div>
          <SmartScoreBadge score={smartScore.score} size="lg" />
        </div>
      </div>

      {!analysis.eligible && analysis.rejectionReason ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Doesn&apos;t meet the Recommended preset: {analysis.rejectionReason}
        </div>
      ) : null}

      {/* Smart Score explainability */}
      <div className="rounded-lg border border-border bg-surface px-5 py-4">
        <div className="mb-3 text-sm font-medium text-foreground">Why this score</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {smartScore.components.map((c) => (
            <div key={c.key} className="text-xs">
              <div className="text-muted">
                {c.label} <span className="text-muted/70">({c.weightPct}%)</span>
              </div>
              <div className="font-medium text-foreground tabular-nums">{c.normalizedScore}/100</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-medium text-profit">Strengths</div>
            {smartScore.strengths.length === 0 ? (
              <div className="text-xs text-muted">None stood out.</div>
            ) : (
              <ul className="space-y-1 text-xs text-muted">
                {smartScore.strengths.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-loss">Risks</div>
            {smartScore.risks.length === 0 ? (
              <div className="text-xs text-muted">None detected.</div>
            ) : (
              <ul className="space-y-1 text-xs text-muted">
                {smartScore.risks.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          label={`Realized PnL (${metrics.windowLabel})`}
          value={<PnlValue pnl={metrics.realizedPnlUsd} />}
        />
        <MetricCard label="Unrealized PnL" value={<PnlValue pnl={metrics.unrealizedPnlUsd} />} />
        <MetricCard label="ROI" value={formatPct(metrics.roiPct.value)} />
        <MetricCard label="Win Rate" value={formatPct(metrics.winRatePct.value)} />
        <MetricCard label="Trades" value={metrics.tradeCount.toLocaleString()} />
        <MetricCard label="Volume" value={formatUsd(metrics.volumeUsd.value)} />
        <MetricCard
          label="Max Drawdown"
          value={
            <>
              {metrics.maxDrawdownPct.value !== null
                ? `-${metrics.maxDrawdownPct.value.toFixed(1)}%`
                : "Unavailable"}
              <ReliabilityTag reliability={metrics.maxDrawdownPct.reliability} />
            </>
          }
        />
        <MetricCard
          label="Trading History"
          value={metrics.tradingHistoryDays !== null ? `~${Math.round(metrics.tradingHistoryDays)}d` : "Unavailable"}
          sublabel="Approximate — bounded by provider history window"
        />
        <MetricCard
          label="Profit Concentration"
          value={
            <>
              {metrics.profitConcentrationPct.value !== null
                ? `${metrics.profitConcentrationPct.value.toFixed(0)}%`
                : "Unavailable"}
              <ReliabilityTag reliability={metrics.profitConcentrationPct.reliability} />
            </>
          }
          sublabel={metrics.profitConcentrationTokenSymbol ? `from ${metrics.profitConcentrationTokenSymbol}` : undefined}
        />
        <MetricCard
          label="Last Activity"
          value={metrics.lastActivityAt ? new Date(metrics.lastActivityAt).toLocaleString() : "Unavailable"}
        />
      </div>

      {/* Positions */}
      <div>
        <div className="mb-2 text-sm font-medium text-foreground">Current Positions</div>
        {positions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            No open positions found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Token</th>
                  <th className="px-3 py-2 font-medium">Quantity</th>
                  <th className="px-3 py-2 font-medium">Avg Entry</th>
                  <th className="px-3 py-2 font-medium">Current Price</th>
                  <th className="px-3 py-2 font-medium">Value</th>
                  <th className="px-3 py-2 font-medium">Unrealized PnL</th>
                  <th className="px-3 py-2 font-medium">Position Age</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.tokenMint} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{p.tokenSymbol ?? shortAddress(p.tokenMint)}</td>
                    <td className="px-3 py-2 tabular-nums">{p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {p.averageEntryPrice.value !== null ? `$${p.averageEntryPrice.value.toPrecision(4)}` : "Entry estimate unavailable"}
                      <ReliabilityTag reliability={p.averageEntryPrice.reliability} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {p.currentPrice.value !== null ? `$${p.currentPrice.value.toPrecision(4)}` : "—"}
                      <ReliabilityTag reliability={p.currentPrice.reliability} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatUsd(p.currentValueUsd.value)}</td>
                    <td className="px-3 py-2">
                      <PnlValue pnl={p.unrealizedPnlUsd} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {p.firstBuyAt ? new Date(p.firstBuyAt).toLocaleDateString() : "Unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trades */}
      <div>
        <div className="mb-2 text-sm font-medium text-foreground">
          Recent Trades <span className="font-normal text-muted">(most recent {trades.length})</span>
        </div>
        {trades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            No recent transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Token</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">USD Value</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Tx</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={`${t.signature}-${t.tokenMint}`} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2">
                      <TransactionTypeBadge type={t.type} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{t.tokenSymbol ?? shortAddress(t.tokenMint)}</td>
                    <td className="px-3 py-2 tabular-nums">{t.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="px-3 py-2">
                      <PnlValue pnl={t.usdValue} />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs">
                      {t.executionPrice.value !== null ? `$${t.executionPrice.value.toPrecision(4)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{new Date(t.timestamp).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <a href={t.explorerUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                        Solscan
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
