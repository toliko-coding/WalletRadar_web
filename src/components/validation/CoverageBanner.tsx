import type { HorizonResult } from "@/lib/validation/dashboard-data";

/**
 * Makes the manual-tick sampling reality visible immediately — sparse
 * short-horizon coverage is expected behavior, not a malfunction, until
 * real-time monitoring exists (see /validation page's own note). Never a
 * single collapsed percentage: on-time / early-only / unavailable stay
 * three distinct numbers exactly the way headline stats treat them.
 */
export function CoverageBanner({ horizons }: { horizons: HorizonResult[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {horizons.map((h) => (
        <div key={h.key} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
          <div className="font-medium text-foreground">{h.label}</div>
          <div className="mt-0.5 text-muted">
            <span className="text-profit">{h.coverage.onTimeCount} on-time</span>
            {" · "}
            <span className="text-warning">{h.coverage.earlyOnlyCount} early-only</span>
            {" · "}
            <span>{h.coverage.unavailableCount} unavailable</span>
          </div>
        </div>
      ))}
    </div>
  );
}
