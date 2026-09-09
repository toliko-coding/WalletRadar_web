import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Conservative operational value based on current observed/request
 * characteristics (see migration 0006's own comment) — not a guarantee.
 * Revisit once real automated tick durations are actually observed.
 */
export const DEFAULT_TICK_LEASE_SECONDS = 300;

/**
 * Thin wrapper around the DB-backed expiring lease (migration 0006) — not
 * pg_try_advisory_lock, which is session-scoped and unsafe under Supabase's
 * connection pooling. Returns true if the lock was acquired (by this
 * `ownerId`), false if another caller currently holds an unexpired lease
 * for this strategy. Throws only on a genuine read/write failure, not on
 * "someone else has it" — that's a normal `false`, not an error.
 */
export async function acquireStrategyTickLock(
  strategyId: string,
  ownerId: string,
  leaseSeconds: number = DEFAULT_TICK_LEASE_SECONDS
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return true; // nothing to lock against if there's no shared store

  const { data, error } = await supabase.rpc("acquire_strategy_tick_lock", {
    p_strategy_id: strategyId,
    p_owner_id: ownerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    throw new Error(`acquiring strategy tick lock: ${error.message}`);
  }
  return data === true;
}

/**
 * Releases the lease only if `ownerId` still matches the current holder —
 * a late release from an already-expired-and-reclaimed lease is a no-op at
 * the DB level (migration 0006), this wrapper just surfaces a genuine
 * read/write failure as a thrown error for the caller to decide how to
 * handle (see runDemoTickLocked: best-effort, never masks the tick result).
 */
export async function releaseStrategyTickLock(strategyId: string, ownerId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;

  const { error } = await supabase.rpc("release_strategy_tick_lock", {
    p_strategy_id: strategyId,
    p_owner_id: ownerId,
  });
  if (error) {
    throw new Error(`releasing strategy tick lock: ${error.message}`);
  }
}
