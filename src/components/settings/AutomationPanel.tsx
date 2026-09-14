import type { AutomationStatus } from "@/lib/automation/status-data";
import type { MaintenanceLockStatus } from "@/lib/jobs/maintenance-lock";
import type { OperationalConfig } from "@/lib/automation/operational-config";
import { computeNextDueAt } from "@/lib/automation/scheduling";
import { deriveRunnerState } from "@/lib/automation/runner-state";
import { classifyBudgetTier, describeBudgetTier, describeBacklogState, isDiscoveryBacklogBlocked } from "@/lib/automation/maintenance-priority";
import { flattenRetryReasons } from "@/lib/telemetry/retry-reasons-display";
import type { JobRunOverview } from "@/lib/discovery/stats";

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

type Tone = "profit" | "warning" | "loss" | "muted";

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const classes = {
    profit: "bg-profit/15 text-profit",
    warning: "bg-warning/15 text-warning",
    loss: "bg-loss/15 text-loss",
    muted: "bg-muted/15 text-muted",
  }[tone];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${classes}`}>{children}</span>;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5 last:border-b-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide text-muted first:mt-0">{children}</div>;
}

const RUNNER_STATE_DISPLAY: Record<string, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "profit" },
  stopped: { label: "Stopped", tone: "muted" },
  unreachable: { label: "Unreachable", tone: "loss" },
  never_started: { label: "Never started", tone: "muted" },
};

function statusTone(status: string | null): Tone {
  if (status === "success") return "profit";
  if (status === "failed") return "loss";
  if (status === null) return "muted";
  return "warning"; // partial, skipped, stopped
}

/**
 * One row for a single scheduled job type — last successful run, next
 * expected/due run, and the most recent attempt's outcome (which may
 * differ from the last SUCCESSFUL run if the latest attempt failed/was
 * skipped). "Next due" is derived from lastJobRunAt (any completion, the
 * actual value the scheduler itself uses — see status-data.ts) plus the
 * currently-configured interval; it is never invented when there's no
 * prior run to compute from (computeNextDueAt returns null, rendered as
 * "due now").
 */
function JobRow({
  label,
  lastRunAt,
  intervalMinutes,
  overview,
}: {
  label: string;
  lastRunAt: string | null;
  intervalMinutes: number;
  overview: JobRunOverview;
}) {
  return (
    <Fact
      label={label}
      value={
        <span className="flex flex-col items-end gap-0.5 text-xs">
          <span className="flex items-center gap-2">
            <Badge tone={statusTone(overview.lastStatus)}>{overview.lastStatus ?? "never run"}</Badge>
            <span className="text-muted">next: {formatFuture(computeNextDueAt(lastRunAt, intervalMinutes))}</span>
          </span>
          <span className="text-muted">
            last successful: {overview.lastSuccessfulAt ? formatAge(overview.lastSuccessfulAt) : "never"}
          </span>
        </span>
      }
    />
  );
}

/**
 * Operational health/observability display for the local automation runner
 * (Corrective Phase v2 checkpoint 5) — never an authority for anything, and
 * strictly read-only: no controls that trigger jobs, change wallet state,
 * or touch the maintenance lock. Receives already-resolved data as props
 * from the Server Component page; never fetches its own HTTP route, and
 * INTERNAL_JOB_SECRET never reaches this component or the browser.
 */
export function AutomationPanel({
  status,
  maintenanceLock,
  operationalConfig,
}: {
  status: AutomationStatus;
  maintenanceLock: MaintenanceLockStatus;
  operationalConfig: OperationalConfig;
}) {
  const { heartbeat, lastJobRunAt, jobRunOverview, recentJobRuns, activeStrategies, pendingCandidateBacklog } = status;

  const runnerState = deriveRunnerState(heartbeat ? { lastHeartbeatAt: heartbeat.lastHeartbeatAt, lastCycleStatus: heartbeat.lastCycleStatus } : null);
  const runnerDisplay = RUNNER_STATE_DISPLAY[runnerState];

  const todayBirdeyeAttempts = status.todayProviderUsage.find((u) => u.provider === "birdeye")?.usage.outboundAttempts ?? 0;
  const budgetTier = classifyBudgetTier(todayBirdeyeAttempts, operationalConfig.budgetRefreshReserveThreshold, heartbeat?.expensiveJobDailyBudget ?? 500);

  const backlogBlocked = isDiscoveryBacklogBlocked(pendingCandidateBacklog, operationalConfig.discoveryBacklogHighWaterMark);

  const retryRows = flattenRetryReasons(status.todayProviderUsage.find((u) => u.provider === "birdeye")?.usage.retryReasons ?? {});

  const automationRuns = recentJobRuns
    .filter((r) => ["demo-tick-active-strategies", "discover-wallets", "analyze-candidate-wallets", "analyze-refresh-wallets"].includes(r.jobName))
    .slice(0, 5);

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-foreground">Automation</div>
      <p className="mb-2 text-xs text-muted">
        Local evidence-collection runner — started/stopped with <code>npm run automation:start</code> /{" "}
        <code>automation:stop</code>, outside this Next.js process. Three independent loops: strategy ticks and the
        heartbeat never wait on maintenance work (discovery/exploration/refresh), which itself runs one at a time.
        Never fabricates progress after downtime — a gap just makes the next check due, never a catch-up burst.
      </p>

      <SectionHeading>Runner</SectionHeading>
      <div className="rounded-lg border border-border bg-surface">
        <Fact
          label="State"
          value={
            <span className="flex items-center gap-2">
              <Badge tone={runnerDisplay.tone}>{runnerDisplay.label}</Badge>
              {heartbeat?.lastHeartbeatAt && <span className="text-xs text-muted">last heartbeat {formatAge(heartbeat.lastHeartbeatAt)}</span>}
            </span>
          }
        />
        {(heartbeat?.pid !== null || heartbeat?.runnerId !== null) && heartbeat && (
          <Fact
            label="Process"
            value={
              <span className="text-xs text-muted">
                {heartbeat.pid !== null ? `pid ${heartbeat.pid}` : "pid unknown"}
                {heartbeat.runnerId ? ` · ${heartbeat.runnerId}` : ""}
              </span>
            }
          />
        )}
        <Fact
          label="Last cycle"
          value={
            heartbeat?.lastCycleCompletedAt ? (
              <span className="flex items-center gap-2">
                <Badge tone={statusTone(heartbeat.lastCycleStatus)}>{heartbeat.lastCycleStatus ?? "unknown"}</Badge>
                <span className="text-xs text-muted">{formatAge(heartbeat.lastCycleCompletedAt)}</span>
              </span>
            ) : (
              <span className="text-muted">none yet</span>
            )
          }
        />
        {heartbeat?.lastError && <Fact label="Last error" value={<span className="text-loss">{heartbeat.lastError}</span>} />}
        <Fact label="Active strategies ticked" value={activeStrategies.length} />
      </div>

      <SectionHeading>Scheduled jobs</SectionHeading>
      <div className="rounded-lg border border-border bg-surface">
        <JobRow label="Strategy tick" lastRunAt={lastJobRunAt.tick} intervalMinutes={heartbeat?.tickIntervalMinutes ?? 15} overview={jobRunOverview.tick} />
        <JobRow
          label="Wallet refresh"
          lastRunAt={lastJobRunAt.analyzeRefresh}
          intervalMinutes={operationalConfig.analyzeRefreshIntervalHours * 60}
          overview={jobRunOverview.analyzeRefresh}
        />
        <JobRow
          label="Wallet exploration"
          lastRunAt={lastJobRunAt.analyze}
          intervalMinutes={(heartbeat?.analyzeIntervalHours ?? 6) * 60}
          overview={jobRunOverview.analyze}
        />
        <JobRow
          label="Wallet discovery"
          lastRunAt={lastJobRunAt.discovery}
          intervalMinutes={(heartbeat?.discoveryIntervalHours ?? 6) * 60}
          overview={jobRunOverview.discovery}
        />
      </div>

      <SectionHeading>Discovery backlog</SectionHeading>
      <div className="rounded-lg border border-border bg-surface">
        <Fact
          label="Pending + failed candidates"
          value={
            <span className="tabular-nums">
              {pendingCandidateBacklog.toLocaleString()} / {operationalConfig.discoveryBacklogHighWaterMark.toLocaleString()} high-water mark
            </span>
          }
        />
        <Fact label="State" value={<Badge tone={backlogBlocked ? "warning" : "profit"}>{describeBacklogState(pendingCandidateBacklog, operationalConfig.discoveryBacklogHighWaterMark)}</Badge>} />
      </div>

      <SectionHeading>Provider budget (maintenance jobs only)</SectionHeading>
      <p className="mb-1.5 text-xs text-muted">
        A self-imposed operational safety budget — not Birdeye&apos;s official quota. Strategy ticks are never gated
        by it.
      </p>
      <div className="rounded-lg border border-border bg-surface">
        <Fact
          label="Today's Birdeye outbound attempts"
          value={<span className="tabular-nums">{todayBirdeyeAttempts.toLocaleString()} / {(heartbeat?.expensiveJobDailyBudget ?? 500).toLocaleString()}</span>}
        />
        <Fact label="Current tier" value={<Badge tone={budgetTier.size === 3 ? "profit" : budgetTier.size === 0 ? "loss" : "warning"}>{describeBudgetTier(budgetTier)}</Badge>} />
      </div>

      <SectionHeading>Global maintenance lock</SectionHeading>
      <div className="rounded-lg border border-border bg-surface">
        <Fact label="State" value={<Badge tone={maintenanceLock.held ? "warning" : "profit"}>{maintenanceLock.held ? "Held" : "Free"}</Badge>} />
        {maintenanceLock.held && (
          <>
            <Fact label="Held by" value={<span className="text-xs">{maintenanceLock.currentJobName}</span>} />
            <Fact label="Locked at" value={<span className="text-xs text-muted">{maintenanceLock.lockedAt ? formatAge(maintenanceLock.lockedAt) : "—"}</span>} />
            <Fact label="Locked until" value={<span className="text-xs text-muted">{maintenanceLock.lockedUntil ? formatFuture(maintenanceLock.lockedUntil) : "—"}</span>} />
          </>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        A crashed holder can leave this showing &quot;Held&quot; for up to 12 hours (the lease ceiling) — that alone
        doesn&apos;t mean the process is still running, only that its lease hasn&apos;t expired yet.
      </p>

      <SectionHeading>Birdeye retry diagnostics (today)</SectionHeading>
      {retryRows.length === 0 ? (
        <p className="text-xs text-muted">No retries recorded today.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Endpoint</th>
                <th className="px-3 py-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {retryRows.map((row) => (
                <tr key={`${row.reason}-${row.path}`} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 capitalize text-foreground">{row.reason.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-xs text-muted">{row.path}</td>
                  <td className="px-3 py-2 tabular-nums">{row.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {automationRuns.length > 0 && (
        <>
          <SectionHeading>Recent job runs</SectionHeading>
          <div className="overflow-x-auto rounded-lg border border-border">
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
                      <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs">{run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
