import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Conservative operational value based on current observed/request
 * characteristics (see migration 0007's own comment) — not a guarantee.
 * Real discovery/analyze runs have taken up to ~5h under real network
 * conditions and Birdeye requests have no client-side timeout yet.
 */
export const DEFAULT_MAINTENANCE_LEASE_SECONDS = 43200;

/**
 * Thin wrapper around the single GLOBAL DB-backed expiring lease (migration
 * 0007) shared by discover-wallets, analyze-candidate-wallets, and
 * analyze-refresh-wallets — "only one maintenance job of any type in flight
 * at a time" is enforced here, not just by maintenanceLoop's own sequential
 * scheduling (which cannot see a manual trigger racing it). Returns true if
 * the lock was acquired (by this `ownerId`, recording `jobName` for
 * observability), false if another caller currently holds an unexpired
 * lease. Throws only on a genuine read/write failure, not on "someone else
 * has it" — that's a normal `false`, not an error.
 */
export async function acquireMaintenanceJobLock(
  ownerId: string,
  jobName: string,
  leaseSeconds: number = DEFAULT_MAINTENANCE_LEASE_SECONDS
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return true; // nothing to lock against if there's no shared store

  const { data, error } = await supabase.rpc("acquire_maintenance_job_lock", {
    p_owner_id: ownerId,
    p_job_name: jobName,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    throw new Error(`acquiring maintenance job lock: ${error.message}`);
  }
  return data === true;
}

/**
 * Releases the lease only if `ownerId` still matches the current holder — a
 * late release from an already-expired-and-reclaimed lease is a no-op at the
 * DB level (migration 0007); this wrapper surfaces a genuine read/write
 * failure as a thrown error for the caller to decide how to handle (see
 * each job's own best-effort release in `finally`).
 */
export async function releaseMaintenanceJobLock(ownerId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;

  const { error } = await supabase.rpc("release_maintenance_job_lock", {
    p_owner_id: ownerId,
  });
  if (error) {
    throw new Error(`releasing maintenance job lock: ${error.message}`);
  }
}

export interface LockSkipped {
  lockSkipped: true;
}

/**
 * Runs `fn` only if the global maintenance lock can be acquired for
 * `jobName`, releasing it in `finally` regardless of outcome. If the lock
 * is already held (by another job type, or a stale-but-unexpired crash) —
 * or the acquire check itself fails (a genuine infra error, treated the
 * same as "couldn't get it" here, fail-closed) — `fn` is NEVER called, so
 * whatever `fn` would have written (a job_runs row, in every caller of this
 * function) simply doesn't happen. This is deliberate: a skipped attempt
 * must not advance the timestamp `isJobDue()` reads for this job — see the
 * Corrective Phase v2 guardrail ("last successful/completed execution ≠
 * last attempted check"). The caller is expected to log/report the skip
 * itself; this wrapper only decides whether `fn` runs at all.
 */
export async function withMaintenanceLock<T>(jobName: string, fn: () => Promise<T>): Promise<T | LockSkipped> {
  const ownerId = crypto.randomUUID();

  let acquired: boolean;
  try {
    acquired = await acquireMaintenanceJobLock(ownerId, jobName);
  } catch {
    return { lockSkipped: true };
  }
  if (!acquired) {
    return { lockSkipped: true };
  }

  try {
    return await fn();
  } finally {
    try {
      await releaseMaintenanceJobLock(ownerId);
    } catch {
      // Best-effort release: if this fails, the lease simply expires
      // naturally (see migration 0007's 12h lease reasoning) and the next
      // acquire recovers it. Never let a release failure mask fn()'s
      // already-computed result, already returned above.
    }
  }
}

export interface MaintenanceLockStatus {
  held: boolean;
  currentJobName: string | null;
  lockedAt: string | null;
  lockedUntil: string | null;
}

/**
 * Read-only status for /settings (Corrective Phase guardrail: the 12h lease
 * must be observable, not silently opaque, precisely because a crashed
 * holder can block every maintenance job type until the lease expires).
 * Never exposes `owner_id` — an internal correlation id, not a credential,
 * but outside the four fields the plan calls for, so omitted here rather
 * than judged case-by-case.
 */
export async function getMaintenanceLockStatus(): Promise<MaintenanceLockStatus> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { held: false, currentJobName: null, lockedAt: null, lockedUntil: null };

  const { data } = await supabase
    .from("maintenance_job_lock")
    .select("current_job_name, locked_at, locked_until")
    .eq("id", "singleton")
    .maybeSingle();

  if (!data) return { held: false, currentJobName: null, lockedAt: null, lockedUntil: null };

  const lockedUntil = data.locked_until as string;
  const held = new Date(lockedUntil).getTime() > Date.now();
  return {
    held,
    currentJobName: data.current_job_name as string,
    lockedAt: data.locked_at as string,
    lockedUntil,
  };
}
