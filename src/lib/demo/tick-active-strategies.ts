import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { listStrategies } from "./strategies";
import { runDemoTickLocked } from "./run-tick";
import { runTicksForStrategies, type TickActiveStrategiesResult } from "./tick-orchestration";

/**
 * The "tick all ACTIVE strategies" orchestration path (Automatic Evidence
 * Collection plan §2) — enumerates ACTIVE demo_strategies and runs the
 * existing, unmodified runDemoTickLocked() for each, isolating failures
 * per-strategy (runTicksForStrategies). Records one job_runs row per
 * cycle, job_name 'demo-tick-active-strategies', reusing the existing
 * table rather than inventing separate tick-history storage — this is
 * also the source `/api/automation/status` reads "last tick cycle" from.
 */
export async function tickActiveStrategies(): Promise<TickActiveStrategiesResult> {
  const startedAt = new Date();
  const supabase = getSupabaseServiceClient();

  const strategies = await listStrategies();
  const result = await runTicksForStrategies(strategies, runDemoTickLocked);

  if (supabase) {
    const completedAt = new Date();
    const failureMessages = result.outcomes.filter((o) => o.error).map((o) => `${o.strategyName}: ${o.error}`);
    const status =
      result.strategiesFailed === 0 ? "success" : result.strategiesFailed < result.strategiesTicked ? "partial" : "failed";

    await supabase.from("job_runs").insert({
      job_name: "demo-tick-active-strategies",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      status,
      processed_items: result.strategiesTicked,
      errors: failureMessages.length > 0 ? failureMessages : null,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
    });
  }

  return result;
}
