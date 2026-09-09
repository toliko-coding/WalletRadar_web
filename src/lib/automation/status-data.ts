import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getTodayProviderUsage, type TodayProviderUsage } from "@/lib/telemetry/provider-usage-data";
import { getRecentJobRuns, type JobRunRecord } from "@/lib/discovery/stats";
import { listStrategies } from "@/lib/demo/strategies";
import type { DemoStrategy } from "@/lib/demo/types";

export interface AutomationHeartbeat {
  runnerId: string | null;
  pid: number | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastCycleCompletedAt: string | null;
  /** Overloaded: a job-cycle outcome ('success'/'partial'/'failed') OR the lifecycle marker 'stopped' written on graceful shutdown — the UI distinguishes by value, not by a separate column, to avoid another migration for a single free-text field. */
  lastCycleStatus: string | null;
  lastError: string | null;
  tickIntervalMinutes: number | null;
  discoveryIntervalHours: number | null;
  analyzeIntervalHours: number | null;
  analyzeBatchSize: number | null;
  expensiveJobDailyBudget: number | null;
}

export interface AutomationStatus {
  /** Health/observability only — never the authority for duplicate-runner detection (that's entirely local, see automation/cli.ts). Null if the runner has never reported in, or Supabase isn't configured. */
  heartbeat: AutomationHeartbeat | null;
  todayProviderUsage: TodayProviderUsage[];
  recentJobRuns: JobRunRecord[];
  activeStrategies: DemoStrategy[];
}

/**
 * Composes already-existing read functions (getTodayProviderUsage,
 * getRecentJobRuns, listStrategies) plus one new heartbeat-row read. This
 * is the single source of truth both `GET /api/automation/status` (for the
 * external runner) and the `/settings` Server Component (calling this
 * directly, no HTTP, no job secret involved) call into. Zero provider
 * calls — every field here is a Supabase read over already-persisted data.
 */
export async function getAutomationStatus(): Promise<AutomationStatus> {
  const supabase = getSupabaseServiceClient();

  const [todayProviderUsage, recentJobRuns, strategies, heartbeatResult] = await Promise.all([
    getTodayProviderUsage(),
    getRecentJobRuns(20),
    listStrategies(),
    supabase
      ? supabase.from("automation_runner_status").select("*").eq("id", "singleton").maybeSingle()
      : Promise.resolve({ data: null as Record<string, unknown> | null }),
  ]);

  const row = heartbeatResult.data;

  return {
    heartbeat: row
      ? {
          runnerId: (row.runner_id as string | null) ?? null,
          pid: (row.pid as number | null) ?? null,
          startedAt: (row.started_at as string | null) ?? null,
          lastHeartbeatAt: (row.last_heartbeat_at as string | null) ?? null,
          lastCycleCompletedAt: (row.last_cycle_completed_at as string | null) ?? null,
          lastCycleStatus: (row.last_cycle_status as string | null) ?? null,
          lastError: (row.last_error as string | null) ?? null,
          tickIntervalMinutes: (row.tick_interval_minutes as number | null) ?? null,
          discoveryIntervalHours: (row.discovery_interval_hours as number | null) ?? null,
          analyzeIntervalHours: (row.analyze_interval_hours as number | null) ?? null,
          analyzeBatchSize: (row.analyze_batch_size as number | null) ?? null,
          expensiveJobDailyBudget: (row.expensive_job_daily_budget as number | null) ?? null,
        }
      : null,
    todayProviderUsage,
    recentJobRuns,
    activeStrategies: strategies.filter((s) => s.status === "ACTIVE"),
  };
}

export interface RecordHeartbeatInput {
  runnerId: string;
  pid: number;
  startedAt: string;
  /** Present only when this poll iteration actually completed a job cycle (or is reporting a lifecycle transition like 'stopped') — a bare liveness ping omits this. */
  cycleCompleted?: { status: string; error?: string | null };
  config: {
    tickIntervalMinutes: number;
    discoveryIntervalHours: number;
    analyzeIntervalHours: number;
    analyzeBatchSize: number;
    expensiveJobDailyBudget: number;
  };
}

/**
 * Upserts the singleton heartbeat row. A plain upsert, not the atomic-
 * increment pattern from provider-usage-data.ts — this is REPLACE
 * semantics (always the same single runner process calling sequentially,
 * one heartbeat at a time), not an accumulating counter, so there's no
 * concurrent-writer race to guard against here.
 */
export async function recordHeartbeat(input: RecordHeartbeatInput): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    id: "singleton",
    runner_id: input.runnerId,
    pid: input.pid,
    started_at: input.startedAt,
    last_heartbeat_at: now,
    tick_interval_minutes: input.config.tickIntervalMinutes,
    discovery_interval_hours: input.config.discoveryIntervalHours,
    analyze_interval_hours: input.config.analyzeIntervalHours,
    analyze_batch_size: input.config.analyzeBatchSize,
    expensive_job_daily_budget: input.config.expensiveJobDailyBudget,
    updated_at: now,
  };
  if (input.cycleCompleted) {
    patch.last_cycle_completed_at = now;
    patch.last_cycle_status = input.cycleCompleted.status;
    patch.last_error = input.cycleCompleted.error ?? null;
  }

  const { error } = await supabase.from("automation_runner_status").upsert(patch);
  if (error) {
    throw new Error(`recording automation heartbeat: ${error.message}`);
  }
}
