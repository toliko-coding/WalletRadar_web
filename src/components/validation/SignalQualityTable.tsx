import type { HorizonResult } from "@/lib/validation/dashboard-data";

const CONFIDENCE_LABEL: Record<string, string> = {
  insufficient: "Insufficient",
  low: "Low",
  moderate: "Moderate",
  strong: "Strong",
};

const CONFIDENCE_CLASS: Record<string, string> = {
  insufficient: "text-loss",
  low: "text-warning",
  moderate: "text-foreground",
  strong: "text-profit",
};

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * The core signal-quality view (plan §F/§K). Every rate/return shown is
 * computed from RESOLVED_ON_TIME observations ONLY — n is always the
 * on-time count, never inflated by early-approximation rows, which are
 * visible here only as their own coverage column. Never sorted or
 * highlighted by rate — the sample-size column is deliberately the most
 * prominent number in each row, not an afterthought.
 */
export function SignalQualityTable({ horizons }: { horizons: HorizonResult[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Horizon</th>
            <th className="px-3 py-2 font-medium">Coverage (on-time / early-only / unavailable)</th>
            <th className="px-3 py-2 font-medium">n (on-time)</th>
            <th className="px-3 py-2 font-medium">Confidence</th>
            <th className="px-3 py-2 font-medium">% Positive</th>
            <th className="px-3 py-2 font-medium">Median Return</th>
            <th className="px-3 py-2 font-medium">Mean Return</th>
          </tr>
        </thead>
        <tbody>
          {horizons.map((h) => (
            <tr key={h.key} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2 font-medium text-foreground">{h.label}</td>
              <td className="px-3 py-2 text-xs text-muted tabular-nums">
                {h.coverage.onTimeCount} · {h.coverage.earlyOnlyCount} · {h.coverage.unavailableCount}
              </td>
              <td className="px-3 py-2 tabular-nums font-medium text-foreground">{h.headline.n}</td>
              <td className={`px-3 py-2 text-xs font-medium ${CONFIDENCE_CLASS[h.headline.confidence]}`}>
                {CONFIDENCE_LABEL[h.headline.confidence]}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatPct(h.headline.positivePct)}</td>
              <td className="px-3 py-2 tabular-nums">
                {formatPct(h.headline.medianReturnPct)}
                {h.headline.hasOutlier ? (
                  <span className="ml-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning" title="An extreme return is far outside the median — the mean below may be misleading.">
                    outlier
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted">{formatPct(h.headline.meanReturnPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
