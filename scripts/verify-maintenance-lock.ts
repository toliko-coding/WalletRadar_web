/**
 * Opt-in, manually-run live integration check for migration 0007's global
 * maintenance lock (acquire_maintenance_job_lock / release_maintenance_job_lock)
 * against the real Supabase project. Deliberately outside `tests/` and never
 * invoked by `npm run test` — the standard suite stays fully deterministic
 * and never touches live data (Corrective Phase plan's own testing
 * discipline, matching scripts/verify-strategy-lock.ts's existing pattern).
 *
 * No throwaway strategy/wallet row is needed here — the lock is a global
 * singleton row, not scoped to any other entity — so this only ever touches
 * `maintenance_job_lock` itself, and deletes that row when done.
 *
 * Run with: npx tsx scripts/verify-maintenance-lock.ts
 *
 * Builds its own Supabase client rather than importing
 * `@/lib/supabase/server` — that module (like every server-only-marked
 * module in this app) starts with `import "server-only"`, which throws
 * unconditionally outside Next's own bundler, so it cannot be imported by a
 * standalone tsx script (see verify-strategy-lock.ts's identical note).
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(resolve(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set in .env.local");
  process.exit(1);
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    pass += 1;
  } else {
    console.error(`  FAIL  ${label}`);
    fail += 1;
  }
}

async function acquire(ownerId: string, jobName: string, leaseSeconds = 43200): Promise<boolean> {
  const { data, error } = await supabase.rpc("acquire_maintenance_job_lock", {
    p_owner_id: ownerId,
    p_job_name: jobName,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`acquire_maintenance_job_lock: ${error.message}`);
  return data === true;
}

async function release(ownerId: string): Promise<void> {
  const { error } = await supabase.rpc("release_maintenance_job_lock", { p_owner_id: ownerId });
  if (error) throw new Error(`release_maintenance_job_lock: ${error.message}`);
}

async function main(): Promise<void> {
  // Clean slate: this is a global singleton row, so remove any pre-existing
  // one from a prior manual run before starting (harmless if none exists).
  await supabase.from("maintenance_job_lock").delete().eq("id", "singleton");

  console.log("1. Acquire succeeds when no row exists yet:");
  check("first acquire (owner-a, discover-wallets) succeeds", await acquire("owner-a", "discover-wallets"));

  console.log("\n2. A second acquire for a DIFFERENT job type fails while the lease is unexpired (proves the lock is global, not per-job-name):");
  check("second acquire (owner-b, analyze-refresh-wallets) fails", (await acquire("owner-b", "analyze-refresh-wallets")) === false);

  console.log("\n3. current_job_name reflects the actual holder:");
  const { data: heldRow } = await supabase
    .from("maintenance_job_lock")
    .select("current_job_name")
    .eq("id", "singleton")
    .maybeSingle();
  check("current_job_name is 'discover-wallets'", heldRow?.current_job_name === "discover-wallets");

  console.log("\n4. Acquire succeeds again once the lease has expired:");
  const { error: expireError } = await supabase
    .from("maintenance_job_lock")
    .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
    .eq("id", "singleton");
  if (expireError) throw new Error(`forcing lease expiry: ${expireError.message}`);
  check("acquire after expiry (owner-c, analyze-candidate-wallets) succeeds", await acquire("owner-c", "analyze-candidate-wallets"));

  console.log("\n5. Release only removes a row whose owner_id matches the caller:");
  await release("owner-a"); // stale owner — must be a safe no-op
  const { data: stillLocked } = await supabase
    .from("maintenance_job_lock")
    .select("owner_id")
    .eq("id", "singleton")
    .maybeSingle();
  check("release with a stale owner_id does not remove the current holder's row", stillLocked?.owner_id === "owner-c");

  await release("owner-c"); // the actual current holder
  const { data: afterRealRelease } = await supabase
    .from("maintenance_job_lock")
    .select("owner_id")
    .eq("id", "singleton")
    .maybeSingle();
  check("release with the matching owner_id removes the row", afterRealRelease === null);

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
