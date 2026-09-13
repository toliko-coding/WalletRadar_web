import { isLoopbackHost } from "@/lib/automation/scheduling";

export interface AutomationConfig {
  apiBaseUrl: string;
  jobSecret: string;
  tickIntervalMinutes: number;
  discoveryIntervalHours: number;
  analyzeIntervalHours: number;
  analyzeBatchSize: number;
  expensiveJobDailyBudget: number;
  pollIntervalSeconds: number;
  /** Corrective Phase v2: the refresh lane's own cadence/batch/staleness — independent of the exploration lane's. */
  analyzeRefreshIntervalHours: number;
  analyzeRefreshBatchSize: number;
  analyzeRefreshStalenessHours: number;
  /** Corrective Phase v2 §4: discovery is skipped for a cycle once pendingCandidateBacklog reaches this — exploration/refresh are unaffected. */
  discoveryBacklogHighWaterMark: number;
  /** Corrective Phase v2 §6: below this, all three maintenance job types are budget-eligible; at/above it (and below expensiveJobDailyBudget), only refresh is. Still a self-imposed operational value, not Birdeye's real quota. */
  budgetRefreshReserveThreshold: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Loads and validates the runner's configuration from process.env
 * (populated from .env.local by the caller — see cli.ts's loadDotEnv,
 * called before this). Throws a descriptive error for anything unsafe to
 * silently default around:
 *
 * - A missing/empty INTERNAL_JOB_SECRET — stricter than the routes' own
 *   soft "allowed through if unset" default (src/lib/jobs/auth.ts):
 *   unattended, repeated automated calls should never run without it, even
 *   though a single manual curl during development still can.
 * - An AUTOMATION_API_BASE_URL that isn't a loopback host — this phase
 *   never targets a remote deployment, and that's enforced here, not just
 *   documented.
 */
export function loadAutomationConfig(): AutomationConfig {
  const jobSecret = process.env.INTERNAL_JOB_SECRET;
  if (!jobSecret) {
    throw new Error(
      "INTERNAL_JOB_SECRET is not set (or is empty) in .env.local. Automation refuses to start without it — set a real value and try again."
    );
  }

  const apiBaseUrl = process.env.AUTOMATION_API_BASE_URL ?? "http://127.0.0.1:3000";
  let hostname: string;
  try {
    hostname = new URL(apiBaseUrl).hostname;
  } catch {
    throw new Error(`AUTOMATION_API_BASE_URL is not a valid URL: "${apiBaseUrl}"`);
  }
  if (!isLoopbackHost(hostname)) {
    throw new Error(
      `AUTOMATION_API_BASE_URL must be a loopback host (127.0.0.1, localhost, or ::1) — got "${hostname}". ` +
        "This phase is local-only and never targets a remote deployment."
    );
  }

  return {
    apiBaseUrl,
    jobSecret,
    tickIntervalMinutes: envInt("AUTOMATION_TICK_INTERVAL_MINUTES", 15),
    discoveryIntervalHours: envInt("AUTOMATION_DISCOVERY_INTERVAL_HOURS", 6),
    analyzeIntervalHours: envInt("AUTOMATION_ANALYZE_INTERVAL_HOURS", 6),
    analyzeBatchSize: envInt("AUTOMATION_ANALYZE_BATCH_SIZE", 10),
    expensiveJobDailyBudget: envInt("AUTOMATION_EXPENSIVE_JOB_DAILY_BUDGET", 500),
    pollIntervalSeconds: envInt("AUTOMATION_POLL_INTERVAL_SECONDS", 60),
    analyzeRefreshIntervalHours: envInt("AUTOMATION_ANALYZE_REFRESH_INTERVAL_HOURS", 24),
    analyzeRefreshBatchSize: envInt("AUTOMATION_ANALYZE_REFRESH_BATCH_SIZE", 10),
    analyzeRefreshStalenessHours: envInt("AUTOMATION_ANALYZE_REFRESH_STALENESS_HOURS", 24),
    discoveryBacklogHighWaterMark: envInt("AUTOMATION_DISCOVERY_BACKLOG_HIGH_WATER_MARK", 500),
    budgetRefreshReserveThreshold: envInt("AUTOMATION_BUDGET_REFRESH_RESERVE_THRESHOLD", 400),
  };
}
