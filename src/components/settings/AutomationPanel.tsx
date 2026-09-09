import type { AutomationStatus } from "@/lib/automation/status-data";
import { computeNextDueAt, shouldStartExpensiveJob } from "@/lib/automation/scheduling";

// Duplicated locally rather than extracted to a shared util — matches the
// existing convention (discover/page.tsx, ConvergenceCard.tsx,
// RefreshAnalysisButton.tsx each define their own identical copy).
function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatFuture(iso: string | null): string {
  if (iso === null) return "due now";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function Badge({ tone, children }: { tone: "profit" | "warning" | "loss" | "muted"; children: React.ReactNode }) {
  const classes =
    tone === "muted"
      ? "bg-muted/15 text-muted"
      : { profit: "bg-profit/15 text-profit", warning: "bg-warning/15 text-warning", loss: "bg-loss/15 text-loss" }[
          tone
        ];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${classes}`}>{children}</span>;
}

// Health is a display heuristic only — a stale/missing heartbeat can mean
// the runner isn't running, OR that it's genuinely alive while Next.js/
// Supabase was briefly unreachable (see automation/lock-file.ts's own doc
// comment). This panel is never the authority automation:start uses; that
// check is entirely local (lock file + PID + `ps`), independent of this.
function runnerHealth(lastHeartbeatAt: string | null): { label: string; tone: "profit" | "warning" | "loss" | "muted" } {
  if (lastHeartbeatAt === null) return { label: "never started", tone: "muted" };
  const ageMinutes = (Date.now() - new Date(lastHeartbeatAt).getTime()) / 60_000;
  if (ageMinutes <= 5) return { label: "healthy", tone: "profit" };
  if (ageMinutes <= 30) return { label: "stale", tone: "warning" };
  return { label: "unreachable", tone: "loss" };
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5 last:border-b-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

/**
 * Operational health/observability display for the local automation runner
 * (Automatic Evidence Collection plan §UI changes) — never an authority for
 * anything. Receives already-resolved data as props from the Server
 * Component page; never fetches its own HTTP route, and INTERNAL_JOB_SECRET
 * never reaches this component or the browser.
 */
export function AutomationPanel({ status }: { status: AutomationStatus }) {
  const { heartbeat, lastJobRunAt, recentJobRuns, activeStrategies } = status;
  const health = runnerHealth(heartbeat?.lastHeartbeatAt ?? null);

  const todayBirdeyeAttempts =
    status.todayProviderUsage.find((u) => u.provider === "birdeye")?.usage.outboundAttempts ?? 0;
  const budget = heartbeat?.expensiveJobDailyBudget ?? null;
  const expensiveJobsAllowed = budget !== null ? shouldStartExpensiveJob(todayBirdeyeAttempts, budget) : null;

  const automationRuns = recentJobRuns
    .filter((r) => ["demo-tick-active-strategies", "discover-wallets", "analyze-candidate-wallets"].includes(r.jobName))
    .slice(0, 5);

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-foreground">Automation</div>
      <p className="mb-2 text-xs text-muted">
        Local evidence-collection runner — started/stopped with <code>npm run automation:start</code> /{" "}
        <code>automation:stop</code>, outside this Next.js process. Never runs while the app is closed; never
        backfills missed cycles after downtime.
      </p>

      <div className="rounded-lg border border-border bg-surface">
        <Fact
          label="Runner state"
          value={
            <span className="flex items-center gap-2">
              <Badge tone={health.tone}>{health.label}</Badge>
              {heartbeat?.lastHeartbeatAt && <span className="text-xs text-muted">last heartbeat {formatAge(heartbeat.lastHeartbeatAt)}</span>}
            </span>
          }
        />
        <Fact
          label="Last cycle"
          value={
            heartbeat?.lastCycleCompletedAt ? (
              <span className="flex items-center gap-2">
                <Badge
                  tone={
                    heartbeat.lastCycleStatus === "success"
                      ? "profit"
                      : heartbeat.lastCycleStatus === "failed"
                        ? "loss"
                        : "warning"
                  }
                >
                  {heartbeat.lastCycleStatus ?? "unknown"}
                </Badge>
                <span className="text-xs text-muted">{formatAge(heartbeat.lastCycleCompletedAt)}</span>
              </span>
            ) : (
              <span className="text-muted">none yet</span>
            )
          }
        />
        {heartbeat?.lastError && (
          <Fact label="Last error" value={<span className="text-loss">{heartbeat.lastError}</span>} />
        )}
        <Fact label="Active strategies ticked" value={activeStrategies.length} />
        <Fact
          label="Strategy ticks"
          value={
            <span className="text-xs">
              last: {lastJobRunAt.tick ? formatAge(lastJobRunAt.tick) : "never"} · next:{" "}
              {formatFuture(computeNextDueAt(lastJobRunAt.tick, heartbeat?.tickIntervalMinutes ?? 15))}
            </span>
          }
        />
        <Fact
          label="Wallet discovery"
          value={
            <span className="text-xs">
              last: {lastJobRunAt.discovery ? formatAge(lastJobRunAt.discovery) : "never"} · next:{" "}
              {formatFuture(computeNextDueAt(lastJobRunAt.discovery, (heartbeat?.discoveryIntervalHours ?? 6) * 60))}
            </span>
          }
        />
        <Fact
          label="Candidate analysis"
          value={
            <span className="text-xs">
              last: {lastJobRunAt.analyze ? formatAge(lastJobRunAt.analyze) : "never"} · next:{" "}
              {formatFuture(computeNextDueAt(lastJobRunAt.analyze, (heartbeat?.analyzeIntervalHours ?? 6) * 60))}
            </span>
          }
        />
        <Fact
          label="Expensive-job budget (discovery + analysis only)"
          value={
            budget !== null ? (
              <span className="flex items-center gap-2">
                <span className="tabular-nums">
                  {todayBirdeyeAttempts.toLocaleString()} / {budget.toLocaleString()} today
                </span>
                {expensiveJobsAllowed === false && <Badge tone="warning">budget reached</Badge>}
              </span>
            ) : (
              <span className="text-muted">runner has not reported in yet</span>
            )
          }
        />
      </div>

      {automationRuns.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {automationRuns.map((run, i) => (
                <tr key={`${run.jobName}-${run.startedAt}-${i}`} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-foreground">{run.jobName}</td>
                  <td className="px-3 py-2 text-xs text-muted">{formatAge(run.startedAt)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={run.status === "success" ? "profit" : run.status === "failed" ? "loss" : "warning"}>
                      {run.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-xs">
                    {run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
