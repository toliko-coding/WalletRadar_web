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
}

/**
 * Freshness is checked FIRST, before the recorded status label — a fresh
 * heartbeat proves the process is alive right now, even if the row's
 * `lastCycleStatus` still says 'stopped' from a prior session (a bare
 * heartbeatLoop ping never touches lastCycleStatus, only
 * last_heartbeat_at — so immediately after a restart, before any job has
 * completed, the row can legitimately show a fresh heartbeat alongside a
 * stale 'stopped' label; freshness must win that comparison). Only once
 * the heartbeat itself is stale do we fall back to asking whether the
 * last thing recorded was an explicit clean shutdown ("stopped") or
 * anything else ("unreachable" — ambiguous: could be crashed, or the
 * whole app/Supabase briefly down while the runner is genuinely alive;
 * this heuristic cannot distinguish those, and doesn't claim to).
 */
export function deriveRunnerState(heartbeat: RunnerHeartbeatForState | null, now: Date = new Date()): RunnerState {
  if (!heartbeat || heartbeat.lastHeartbeatAt === null) return "never_started";

  const ageMinutes = (now.getTime() - new Date(heartbeat.lastHeartbeatAt).getTime()) / 60_000;
  if (ageMinutes <= RUNNING_FRESHNESS_MINUTES) return "running";

  return heartbeat.lastCycleStatus === "stopped" ? "stopped" : "unreachable";
}
