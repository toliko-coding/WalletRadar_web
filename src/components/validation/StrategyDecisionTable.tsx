import Link from "next/link";
import type { StrategyDecisionBreakdown } from "@/lib/validation/dashboard-data";

const DECISION_LABEL: Record<string, string> = {
  TRADED: "Traded",
  SKIPPED_ALREADY_HOLDING: "Already holding",
  SKIPPED_MAX_POSITIONS: "Max positions",
  SKIPPED_ALLOCATION: "Max allocation",
  SKIPPED_INSUFFICIENT_CASH: "Insufficient cash",
  SKIPPED_RISK_FILTER: "Risk filter",
  SKIPPED_NO_PRICE: "No price",
  SKIPPED_PREDATES_STRATEGY: "Predates strategy",
};

const DECISION_ORDER = Object.keys(DECISION_LABEL);

/**
 * Strategy-quality view (plan §G) — a different question from signal
 * quality: not "was the signal good" but "given this strategy's capital/
 * risk rules, what did it do about the signals it saw." SKIPPED_PREDATES_
 * STRATEGY is shown as a raw audit count only, never a rate — it exists
 * purely to prove the strategy correctly refused to backdate itself.
 */
export function StrategyDecisionTable({ rows }: { rows: StrategyDecisionBreakdown[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Strategy</th>
            <th className="px-3 py-2 font-medium">Total Events Seen</th>
            {DECISION_ORDER.map((d) => (
              <th key={d} className="px-3 py-2 font-medium">
                {DECISION_LABEL[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.strategyId} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2">
                <Link href={`/demo?strategy=${row.strategyId}`} className="text-accent hover:underline">
                  {row.strategyName}
                </Link>
              </td>
              <td className="px-3 py-2 tabular-nums font-medium text-foreground">{row.total}</td>
              {DECISION_ORDER.map((d) => (
                <td key={d} className="px-3 py-2 tabular-nums text-muted">
                  {row.counts[d as keyof typeof row.counts] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
