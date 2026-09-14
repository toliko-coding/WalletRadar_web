import "server-only";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface OperationalConfig {
  analyzeRefreshIntervalHours: number;
  analyzeRefreshBatchSize: number;
  analyzeRefreshStalenessHours: number;
  discoveryBacklogHighWaterMark: number;
  budgetRefreshReserveThreshold: number;
}

/**
 * Reads the SAME env vars automation/config.ts (the standalone runner)
 * reads, for /settings display only — this is the Next.js process's own
 * view of `.env.local`, not a live value reported by the runner process
 * itself (automation_runner_status has no columns for these — see
 * migration 0007's scope, deliberately unchanged in this checkpoint to
 * avoid a new migration for a display-only need). On a single local
 * machine both processes read the same file, so this matches the
 * runner's actual effective config in practice; if they were ever
 * pointed at different env files this display could drift from the
 * runner's real behavior — not something this read-only checkpoint
 * detects or corrects.
 */
export function getOperationalConfig(): OperationalConfig {
  return {
    analyzeRefreshIntervalHours: envInt("AUTOMATION_ANALYZE_REFRESH_INTERVAL_HOURS", 24),
    analyzeRefreshBatchSize: envInt("AUTOMATION_ANALYZE_REFRESH_BATCH_SIZE", 10),
    analyzeRefreshStalenessHours: envInt("AUTOMATION_ANALYZE_REFRESH_STALENESS_HOURS", 24),
    discoveryBacklogHighWaterMark: envInt("AUTOMATION_DISCOVERY_BACKLOG_HIGH_WATER_MARK", 500),
    budgetRefreshReserveThreshold: envInt("AUTOMATION_BUDGET_REFRESH_RESERVE_THRESHOLD", 400),
  };
}
