import type { TodayProviderUsage } from "@/lib/telemetry/provider-usage-data";

function formatHitRate(hits: number, misses: number): string {
  const total = hits + misses;
  if (total === 0) return "—";
  return `${((hits / total) * 100).toFixed(1)}%`;
}

/**
 * A small, focused read of today's UTC provider_usage_daily rows — not a
 * historical trend view or a per-request drill-down, deliberately (see the
 * approved Provider Usage Telemetry plan §G). Zero provider calls; this is
 * a pure read over already-persisted counters.
 */
export function ProviderUsagePanel({ usage }: { usage: TodayProviderUsage[] }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-foreground">Provider Usage Today (UTC)</div>
      <p className="mb-2 text-xs text-muted">
        Best-effort telemetry, not exact billing-grade accounting — a process crash or a brief
        Supabase outage can silently lose an increment (see migration 0005). Resets at 00:00 UTC,
        not on a rolling 24h window.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Outbound Attempts</th>
              <th className="px-3 py-2 font-medium">Successful Requests</th>
              <th className="px-3 py-2 font-medium">Retries</th>
              <th className="px-3 py-2 font-medium">Cache Hits</th>
              <th className="px-3 py-2 font-medium">Cache Misses</th>
              <th className="px-3 py-2 font-medium">Cache Hit Rate</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((row) => (
              <tr key={row.provider} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 font-medium capitalize text-foreground">{row.provider}</td>
                <td className="px-3 py-2 tabular-nums">{row.usage.outboundAttempts.toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums">{row.usage.successfulRequests.toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums text-muted">{row.usage.retries.toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums">{row.usage.cacheHits.toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums">{row.usage.cacheMisses.toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums">{formatHitRate(row.usage.cacheHits, row.usage.cacheMisses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
