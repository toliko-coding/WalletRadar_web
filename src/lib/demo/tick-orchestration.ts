/**
 * Pure tick-all orchestration logic — no I/O, so unit-testable without a
 * Supabase connection. See tick-active-strategies.ts for the actual
 * listStrategies()/job_runs orchestration this is used from.
 */
import type { DemoStrategy } from "./types";
import type { DemoTickResult } from "./run-tick";

export function selectActiveStrategies(strategies: DemoStrategy[]): DemoStrategy[] {
  return strategies.filter((s) => s.status === "ACTIVE");
}

export interface StrategyTickOutcome {
  strategyId: string;
  strategyName: string;
  result?: DemoTickResult;
  error?: string;
}

export interface TickActiveStrategiesResult {
  strategiesTicked: number;
  strategiesFailed: number;
  outcomes: StrategyTickOutcome[];
}

/**
 * Ticks every ACTIVE strategy, one at a time — sequential by construction,
 * never concurrent within this loop (a *different* overlapping caller is
 * what runDemoTickLocked's per-strategy lease guards against, not this
 * loop). One strategy throwing never stops the rest: each call is
 * individually try/caught and recorded in the aggregate result, never
 * duplicating any trading/validation logic itself — `tickFn` is the only
 * thing this function calls to actually tick a strategy, so it doesn't
 * need to know how a tick works, only how to run one and isolate its
 * failure.
 */
export async function runTicksForStrategies(
  strategies: DemoStrategy[],
  tickFn: (strategyId: string) => Promise<DemoTickResult>
): Promise<TickActiveStrategiesResult> {
  const active = selectActiveStrategies(strategies);
  const outcomes: StrategyTickOutcome[] = [];
  let strategiesFailed = 0;

  for (const strategy of active) {
    try {
      const result = await tickFn(strategy.id);
      outcomes.push({ strategyId: strategy.id, strategyName: strategy.name, result });
    } catch (err) {
      strategiesFailed += 1;
      outcomes.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { strategiesTicked: active.length, strategiesFailed, outcomes };
}
