/**
 * Opt-in, manually-run live integration check for migration 0006's lock
 * table/functions (acquire_strategy_tick_lock / release_strategy_tick_lock)
 * against the real Supabase project. Deliberately outside `tests/` and
 * never invoked by `npm run test` — the standard suite stays fully
 * deterministic and never touches live data (Automatic Evidence Collection
 * plan §Testing plan).
 *
 * Creates one throwaway `demo_strategies` row, exercises acquire/conflict/
 * expiry/release against it, then deletes it — bounded, self-cleaning, no
 * lasting effect on the project.
 *
 * Run with: npx tsx scripts/verify-strategy-lock.ts
 *
 * Builds its own Supabase client rather than importing
 * `@/lib/supabase/server` — that module (like every server-only-marked
 * module in this app) starts with `import "server-only"`, which throws
 * unconditionally outside Next's own bundler (verified: `node_modules/
 * server-only/index.js` throws with no environment check at all), so it
 * cannot be imported by a standalone tsx script.
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

async function acquire(strategyId: string, ownerId: string, leaseSeconds = 300): Promise<boolean> {
  const { data, error } = await supabase.rpc("acquire_strategy_tick_lock", {
    p_strategy_id: strategyId,
    p_owner_id: ownerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`acquire_strategy_tick_lock: ${error.message}`);
  return data === true;
}

async function release(strategyId: string, ownerId: string): Promise<void> {
  const { error } = await supabase.rpc("release_strategy_tick_lock", {
    p_strategy_id: strategyId,
    p_owner_id: ownerId,
  });
  if (error) throw new Error(`release_strategy_tick_lock: ${error.message}`);
}

async function main(): Promise<void> {
  console.log("Creating a throwaway demo_strategies row...");
  const { data: strategy, error: insertError } = await supabase
    .from("demo_strategies")
    .insert({ name: "verify-strategy-lock (throwaway, safe to delete)", starting_capital_usd: 1000 })
    .select("id")
    .single();
  if (insertError || !strategy) {
    throw new Error(`creating throwaway strategy: ${insertError?.message}`);
  }
  const strategyId = strategy.id as string;
  console.log(`Created strategy ${strategyId}`);

  try {
    console.log("\n1. Acquire succeeds when no row exists yet:");
    check("first acquire (owner-a) succeeds", await acquire(strategyId, "owner-a"));

    console.log("\n2. A second acquire for the same strategy fails while the lease is unexpired:");
    check("second acquire (owner-b) fails", (await acquire(strategyId, "owner-b")) === false);

    console.log("\n3. Acquire succeeds again once the lease has expired:");
    // Force the existing row's lease into the past to simulate expiry
    // without waiting out a real 300s lease.
    const { error: expireError } = await supabase
      .from("strategy_tick_locks")
      .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
      .eq("strategy_id", strategyId);
    if (expireError) throw new Error(`forcing lease expiry: ${expireError.message}`);
    check("acquire after expiry (owner-c) succeeds", await acquire(strategyId, "owner-c"));

    console.log("\n4. Release only removes a row whose owner_id matches the caller:");
    await release(strategyId, "owner-a"); // stale owner — must be a safe no-op
    const { data: stillLocked } = await supabase
      .from("strategy_tick_locks")
      .select("owner_id")
      .eq("strategy_id", strategyId)
      .maybeSingle();
    check("release with a stale owner_id does not remove the current holder's row", stillLocked?.owner_id === "owner-c");

    await release(strategyId, "owner-c"); // the actual current holder
    const { data: afterRealRelease } = await supabase
      .from("strategy_tick_locks")
      .select("owner_id")
      .eq("strategy_id", strategyId)
      .maybeSingle();
    check("release with the matching owner_id removes the row", afterRealRelease === null);
  } finally {
    console.log(`\nCleaning up: deleting throwaway strategy ${strategyId} (cascades to strategy_tick_locks)...`);
    const { error: deleteError } = await supabase.from("demo_strategies").delete().eq("id", strategyId);
    if (deleteError) {
      console.error(`WARNING: cleanup failed, delete manually: ${deleteError.message}`);
    } else {
      console.log("Cleaned up.");
    }
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
