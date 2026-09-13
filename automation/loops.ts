/**
 * The testable core of each of the three runner loops — one function per
 * loop, each doing exactly one due-check-and-maybe-run iteration. Kept
 * separate from runner.ts's actual `while` loops (trivial glue: call this,
 * sleep, repeat, handle shutdown) so tests can exercise the real decision
 * logic with injected fetchStatus/postJob/postHeartbeat, including
 * simulating a slow maintenance job without waiting on a real one
 * (Corrective Phase v2's own testing requirement).
 *
 * tickLoop and maintenanceLoop are independent by construction: neither
 * function calls the other, and each is driven by its own `while` loop in
 * runner.ts — a slow `deps.postJob` inside runOneMaintenanceCheck cannot
 * block a concurrent call to runOneTickCheck, because they are separate
 * promise chains, not nested awaits.
 */
import type { AutomationConfig } from "./config";
import type { AutomationStatus, RecordHeartbeatInput } from "@/lib/automation/status-data";
import { fetchStatus as realFetchStatus, postJob as realPostJob, postHeartbeat as realPostHeartbeat } from "./api-client";
import { isJobDue } from "@/lib/automation/scheduling";
import { classifyBudgetTier, isDiscoveryBacklogBlocked, pickMaintenanceJob, type MaintenanceJobType } from "@/lib/automation/maintenance-priority";

export interface RunnerIdentity {
  runnerId: string;
  pid: number;
  startedAt: string;
}

export interface LoopDeps {
  fetchStatus: (config: AutomationConfig) => Promise<AutomationStatus>;
  postJob: (config: AutomationConfig, path: string, body?: unknown) => Promise<Record<string, unknown>>;
  postHeartbeat: (config: AutomationConfig, payload: RecordHeartbeatInput) => Promise<void>;
  log: (message: string) => void;
}

export const defaultLoopDeps: LoopDeps = {
  fetchStatus: realFetchStatus,
  postJob: realPostJob,
  postHeartbeat: realPostHeartbeat,
  log: (message: string) => console.log(`[automation ${new Date().toISOString()}] ${message}`),
};

function heartbeatConfig(config: AutomationConfig): RecordHeartbeatInput["config"] {
  return {
    tickIntervalMinutes: config.tickIntervalMinutes,
    discoveryIntervalHours: config.discoveryIntervalHours,
    analyzeIntervalHours: config.analyzeIntervalHours,
    analyzeBatchSize: config.analyzeBatchSize,
    expensiveJobDailyBudget: config.expensiveJobDailyBudget,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One tickLoop iteration: fetch fresh status, run the tick job if due.
 * Never gated by the provider budget — cheap, and the entire reason this
 * phase exists. A `fetchStatus` failure propagates to the caller (Next.js
 * unreachable, etc. — "attempted call, not a successful run," matches the
 * original due-state guardrail); a `postJob`/`postHeartbeat` failure after
 * that point is caught here so it never crashes the loop.
 */
export async function runOneTickCheck(config: AutomationConfig, identity: RunnerIdentity, deps: LoopDeps = defaultLoopDeps): Promise<void> {
  const status = await deps.fetchStatus(config);
  if (!isJobDue(status.lastJobRunAt.tick, config.tickIntervalMinutes)) return;

  try {
    await deps.postJob(config, "/api/jobs/tick-active-strategies");
    deps.log("tick-active-strategies completed");
    await deps.postHeartbeat(config, { ...identity, cycleCompleted: { status: "success" }, config: heartbeatConfig(config) }).catch(() => {});
  } catch (err) {
    const message = errorMessage(err);
    deps.log(`tick-active-strategies FAILED: ${message}`);
    await deps
      .postHeartbeat(config, { ...identity, cycleCompleted: { status: "failed", error: message }, config: heartbeatConfig(config) })
      .catch(() => {});
  }
}

const MAINTENANCE_JOB_REQUESTS: Record<MaintenanceJobType, (config: AutomationConfig) => { path: string; body?: unknown }> = {
  refresh: (config) => ({
    path: "/api/jobs/analyze-refresh-wallets",
    body: { limit: config.analyzeRefreshBatchSize, stalenessHours: config.analyzeRefreshStalenessHours },
  }),
  exploration: (config) => ({ path: "/api/jobs/analyze-candidates", body: { limit: config.analyzeBatchSize } }),
  discovery: () => ({ path: "/api/jobs/discover-wallets" }),
};

/**
 * One maintenanceLoop iteration: fetch fresh status, determine which of
 * refresh/exploration/discovery are BOTH due and eligible (budget tier;
 * discovery additionally gated by the backlog high-water mark), then run
 * AT MOST ONE of them — the highest-priority eligible one (REFRESH >
 * EXPLORATION > DISCOVERY). Whichever isn't picked is simply reconsidered
 * next iteration; this is what keeps "only one maintenance job in flight
 * at a time" true even before the DB-backed global lock (migration 0007)
 * is ever consulted — the lock exists for callers this loop can't see
 * (manual triggers), not for this loop's own self-overlap.
 *
 * `lockSkipped` in the response is explicitly NOT treated as a successful
 * run for heartbeat-reporting purposes (a distinct "skipped" status), even
 * though job_runs itself already correctly has no row either way (see
 * withMaintenanceLock's own doc comment) — this only affects what gets
 * logged/reported, never due-state correctness.
 */
export async function runOneMaintenanceCheck(config: AutomationConfig, identity: RunnerIdentity, deps: LoopDeps = defaultLoopDeps): Promise<void> {
  const status = await deps.fetchStatus(config);
  const todayBirdeyeAttempts = status.todayProviderUsage.find((u) => u.provider === "birdeye")?.usage.outboundAttempts ?? 0;
  const budgetTier = classifyBudgetTier(todayBirdeyeAttempts, config.budgetRefreshReserveThreshold, config.expensiveJobDailyBudget);

  const refreshDue = isJobDue(status.lastJobRunAt.analyzeRefresh, config.analyzeRefreshIntervalHours * 60);
  const explorationDue = isJobDue(status.lastJobRunAt.analyze, config.analyzeIntervalHours * 60);
  const discoveryDue = isJobDue(status.lastJobRunAt.discovery, config.discoveryIntervalHours * 60);
  const discoveryBacklogBlocked = isDiscoveryBacklogBlocked(status.pendingCandidateBacklog, config.discoveryBacklogHighWaterMark);

  const eligible = new Set<MaintenanceJobType>();
  if (refreshDue && budgetTier.has("refresh")) eligible.add("refresh");
  if (explorationDue && budgetTier.has("exploration")) eligible.add("exploration");
  if (discoveryDue && budgetTier.has("discovery") && !discoveryBacklogBlocked) eligible.add("discovery");

  const chosen = pickMaintenanceJob(eligible);
  if (!chosen) return;

  const { path, body } = MAINTENANCE_JOB_REQUESTS[chosen](config);
  try {
    const response = await deps.postJob(config, path, body);
    if (response?.lockSkipped === true) {
      deps.log(`${chosen} skipped — maintenance lock already held by another job`);
      await deps.postHeartbeat(config, { ...identity, cycleCompleted: { status: "skipped" }, config: heartbeatConfig(config) }).catch(() => {});
    } else {
      deps.log(`${chosen} completed`);
      await deps.postHeartbeat(config, { ...identity, cycleCompleted: { status: "success" }, config: heartbeatConfig(config) }).catch(() => {});
    }
  } catch (err) {
    const message = errorMessage(err);
    deps.log(`${chosen} FAILED: ${message}`);
    await deps
      .postHeartbeat(config, { ...identity, cycleCompleted: { status: "failed", error: message }, config: heartbeatConfig(config) })
      .catch(() => {});
  }
}

/**
 * One heartbeatLoop iteration: a bare liveness ping, no job attempted, no
 * `cycleCompleted` — decoupled from whatever tickLoop/maintenanceLoop are
 * doing, so `last_heartbeat_at` stays fresh even during a long maintenance
 * job (previously, the single-cycle design meant heartbeat also went stale
 * for the same multi-hour stretches ticks did).
 */
export async function runOneHeartbeatPing(config: AutomationConfig, identity: RunnerIdentity, deps: LoopDeps = defaultLoopDeps): Promise<void> {
  await deps.postHeartbeat(config, { ...identity, config: heartbeatConfig(config) });
}
