import type { JobRunRecord } from "@/lib/discovery/stats";

const JOB_LABELS: Record<string, string> = {
  "discover-wallets": "Discovery Scan",
  "analyze-candidate-wallets": "Analyze Candidates",
};

const STATUS_STYLES: Record<string, string> = {
  success: "bg-profit/15 text-profit",
  partial: "bg-warning/15 text-warning",
  failed: "bg-loss/15 text-loss",
  running: "bg-accent/15 text-accent",
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function JobRunHistory({ runs }: { runs: JobRunRecord[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
        No job runs recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Job</th>
            <th className="px-3 py-2 font-medium">Started</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Processed</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Errors</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, i) => (
            <tr key={`${run.jobName}-${run.startedAt}-${i}`} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2">{JOB_LABELS[run.jobName] ?? run.jobName}</td>
              <td className="px-3 py-2 text-xs text-muted">{new Date(run.startedAt).toLocaleString()}</td>
              <td className="px-3 py-2">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[run.status] ?? "bg-surface-raised text-muted"}`}>
                  {run.status}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums">{run.processedItems}</td>
              <td className="px-3 py-2 text-xs text-muted">{formatDuration(run.durationMs)}</td>
              <td className="px-3 py-2 text-xs text-loss">
                {run.errors && run.errors.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer">{run.errors.length} error(s)</summary>
                    <ul className="mt-1 space-y-0.5 text-muted">
                      {run.errors.slice(0, 10).map((e, j) => (
                        <li key={j}>• {e}</li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
