/**
 * Opt-in, manually-run live integration check for migration 0008's nested
 * `retry_reasons` JSONB merge inside `increment_provider_usage`. Deliberately
 * outside `tests/` and never invoked by `npm run test` (same discipline as
 * scripts/verify-strategy-lock.ts and scripts/verify-maintenance-lock.ts).
 *
 * Covers, in order:
 *  1-5. The nested reason -> path -> count merge itself (jsonb_set does not
 *       auto-create missing intermediate objects, so this proves the
 *       function's two-step ensure-then-set approach actually works against
 *       real Postgres, not just by reading the SQL).
 *  6. The legacy 7-argument call shape (omitting p_retry_reasons entirely)
 *     still works against the new 8-argument function — proving migration
 *     0008's explicit `drop function` + recreate left exactly one
 *     increment_provider_usage, not an ambiguous pair of overloads.
 *  7. Concurrent increments (numeric-only and nested-JSONB mixed) preserve
 *     every counter correctly — no lost updates under real concurrent RPC
 *     calls, proving the row-lock approach is actually safe, not just
 *     reasoned-about.
 *
 * Uses a throwaway (usage_date, provider) pair — '2099-01-01' / 'birdeye' —
 * that can never collide with real telemetry, and deletes it when done.
 *
 * Run with: npx tsx scripts/verify-retry-reason-telemetry.ts
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
const THROWAWAY_DATE = "2099-01-01";
const THROWAWAY_PROVIDER = "birdeye";

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

async function increment(params: {
  outboundAttempts?: number;
  retryReasons?: Record<string, Record<string, number>>;
  omitRetryReasonsEntirely?: boolean;
}): Promise<void> {
  const body: Record<string, unknown> = {
    p_date: THROWAWAY_DATE,
    p_provider: THROWAWAY_PROVIDER,
    p_outbound_attempts: params.outboundAttempts ?? 1,
  };
  // Only set p_retry_reasons when NOT simulating a legacy caller — a true
  // legacy call passes just the original 7 named params, relying entirely
  // on the new parameter's own SQL-level default.
  if (!params.omitRetryReasonsEntirely) {
    body.p_retry_reasons = params.retryReasons ?? {};
  }
  const { error } = await supabase.rpc("increment_provider_usage", body);
  if (error) throw new Error(`increment_provider_usage: ${error.message}`);
}

async function readRow(): Promise<{ outboundAttempts: number; retryReasons: Record<string, Record<string, number>> }> {
  const { data, error } = await supabase
    .from("provider_usage_daily")
    .select("outbound_attempts, retry_reasons")
    .eq("usage_date", THROWAWAY_DATE)
    .eq("provider", THROWAWAY_PROVIDER)
    .maybeSingle();
  if (error) throw new Error(`reading row: ${error.message}`);
  return {
    outboundAttempts: (data?.outbound_attempts as number) ?? 0,
    retryReasons: (data?.retry_reasons as Record<string, Record<string, number>>) ?? {},
  };
}

async function cleanSlate(): Promise<void> {
  await supabase.from("provider_usage_daily").delete().eq("usage_date", THROWAWAY_DATE).eq("provider", THROWAWAY_PROVIDER);
}

async function main(): Promise<void> {
  await cleanSlate();

  console.log("1. First increment creates a brand-new nested reason -> path -> count structure from '{}':");
  await increment({ retryReasons: { rate_limited: { "/defi/price": 2 } } });
  let row = await readRow();
  check("rate_limited./defi/price is 2", row.retryReasons.rate_limited?.["/defi/price"] === 2);

  console.log("\n2. A second increment adds to an EXISTING (reason, path) pair rather than overwriting it:");
  await increment({ retryReasons: { rate_limited: { "/defi/price": 3 } } });
  row = await readRow();
  check("rate_limited./defi/price is now 5 (2 + 3)", row.retryReasons.rate_limited?.["/defi/price"] === 5);

  console.log("\n3. Adding a NEW path under an EXISTING reason preserves the old path's count:");
  await increment({ retryReasons: { rate_limited: { "/wallet/v2/trade-data/single": 1 } } });
  row = await readRow();
  check("rate_limited./defi/price is still 5", row.retryReasons.rate_limited?.["/defi/price"] === 5);
  check("rate_limited./wallet/v2/trade-data/single is 1", row.retryReasons.rate_limited?.["/wallet/v2/trade-data/single"] === 1);

  console.log("\n4. Adding a brand-new REASON preserves every existing reason's data:");
  await increment({ retryReasons: { network_error: { "/defi/price": 7 } } });
  row = await readRow();
  check("network_error./defi/price is 7", row.retryReasons.network_error?.["/defi/price"] === 7);
  check("rate_limited./defi/price is still 5 after adding a sibling reason", row.retryReasons.rate_limited?.["/defi/price"] === 5);
  check("rate_limited./wallet/v2/trade-data/single is still 1", row.retryReasons.rate_limited?.["/wallet/v2/trade-data/single"] === 1);

  console.log("\n5. An increment with an EMPTY retry_reasons object is a correct no-op:");
  await increment({ retryReasons: {} });
  row = await readRow();
  check(
    "nothing changed after an empty-object increment",
    row.retryReasons.rate_limited?.["/defi/price"] === 5 && row.retryReasons.network_error?.["/defi/price"] === 7
  );

  console.log("\n6. A legacy-style call (p_retry_reasons omitted entirely, not even '{}') still works —");
  console.log("   proves migration 0008's drop+recreate left exactly ONE increment_provider_usage, not an ambiguous overload pair:");
  const beforeLegacy = await readRow();
  await increment({ omitRetryReasonsEntirely: true, outboundAttempts: 4 });
  row = await readRow();
  check("outbound_attempts increased by exactly 4", row.outboundAttempts === beforeLegacy.outboundAttempts + 4);
  check("retry_reasons is untouched by a call that omits it", JSON.stringify(row.retryReasons) === JSON.stringify(beforeLegacy.retryReasons));

  console.log("\n7. Concurrent increments (numeric-only and nested-JSONB mixed) preserve every counter — no lost updates:");
  await cleanSlate();
  const CONCURRENT_CALLS = 20;
  const calls = Array.from({ length: CONCURRENT_CALLS }, (_, i) =>
    increment({
      outboundAttempts: 1,
      retryReasons: i % 2 === 0 ? { rate_limited: { "/defi/price": 1 } } : { network_error: { "/wallet/v2/trade-data/single": 1 } },
    })
  );
  await Promise.all(calls);
  row = await readRow();
  check(`outbound_attempts equals ${CONCURRENT_CALLS} after ${CONCURRENT_CALLS} concurrent calls (no lost numeric updates)`, row.outboundAttempts === CONCURRENT_CALLS);
  check("rate_limited./defi/price equals 10 (half of the concurrent calls, no lost JSONB updates)", row.retryReasons.rate_limited?.["/defi/price"] === 10);
  check(
    "network_error./wallet/v2/trade-data/single equals 10 (the other half, no lost JSONB updates)",
    row.retryReasons.network_error?.["/wallet/v2/trade-data/single"] === 10
  );

  console.log("\n8. Cleaning up the throwaway row...");
  const { error: deleteError } = await supabase
    .from("provider_usage_daily")
    .delete()
    .eq("usage_date", THROWAWAY_DATE)
    .eq("provider", THROWAWAY_PROVIDER);
  if (deleteError) {
    console.error(`WARNING: cleanup failed, delete manually: ${deleteError.message}`);
  } else {
    console.log("Cleaned up.");
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
