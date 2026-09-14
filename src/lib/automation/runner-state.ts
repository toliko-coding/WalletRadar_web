/**
 * Pure Running/Stopped/Unreachable derivation for /settings (Corrective
 * Phase v2 checkpoint 5) — no I/O, unit-testable. This is a DISPLAY
 * heuristic only, never the authority for duplicate-runner detection
 * (that stays entirely local — lock file + PID + `ps`, see
 * automation/lock-file.ts) or for scheduling.
 */

export type RunnerState = "running" | "stopped" | "unreachable" | "never_started";

/** ~3x the default 60s poll interval — comfortable buffer for an occasional slow tick without a false "unreachable". */
export const RUNNING_FRESHNESS_MINUTES = 3;

export interface RunnerHeartbeatForState {
  lastHeartbeatAt: string | null;
  lastCycleStatus: string | null;
  lastCycleCompletedAt: string | null;
}

/**
 * Two competing scenarios both involve a FRESH `lastHeartbeatAt` sitting
 * alongside a `lastCycleStatus` of `'stopped'`, and they must resolve to
 * opposite answers:
 *
 *  (a) The runner just cleanly shut down. Its final heartbeat write sets
 *      `lastHeartbeatAt` and `lastCycleCompletedAt` to the SAME instant
 *      (recordHeartbeat's upsert stamps both from one `now`) — this is a
 *      CURRENT "stopped" report, and must read as "stopped" immediately,
 *      not "running" for the next few minutes just because the timestamp
 *      is recent.
 *  (b) The runner was restarted after a PRIOR clean stop, and has sent one
 *      or more bare heartbeatLoop pings since, but hasn't completed a job
 *      yet. A bare ping only ever advances `lastHeartbeatAt`, never
 *      `lastCycleStatus`/`lastCycleCompletedAt` — so this state has
 *      `lastHeartbeatAt` STRICTLY NEWER than `lastCycleCompletedAt`, even
 *      though the stale label still says 'stopped'. This must read as
 *      "running": a live ping proves the process is alive right now.
 *
 * The distinguishing signal is exactly that ordering: a `lastCycleStatus`
 * of 'stopped' is only trusted as CURRENT when `lastHeartbeatAt` is no
 * newer than `lastCycleCompletedAt` (nothing has happened since the stop
 * was recorded). Once a newer heartbeat exists, the stale 'stopped' label
 * is ignored and freshness alone decides "running" vs "unreachable".
 */
export function deriveRunnerState(heartbeat: RunnerHeartbeatForState | null, now: Date = new Date()): RunnerState {
  if (!heartbeat || heartbeat.lastHeartbeatAt === null) return "never_started";

  const heartbeatTime = new Date(heartbeat.lastHeartbeatAt).getTime();

  const stoppedIsCurrent =
    heartbeat.lastCycleStatus === "stopped" &&
    heartbeat.lastCycleCompletedAt !== null &&
    heartbeatTime <= new Date(heartbeat.lastCycleCompletedAt).getTime();
  if (stoppedIsCurrent) return "stopped";

  const ageMinutes = (now.getTime() - heartbeatTime) / 60_000;
  return ageMinutes <= RUNNING_FRESHNESS_MINUTES ? "running" : "unreachable";
}
