/**
 * Opt-in, manually-run live integration check for migration 0008's nested
 * `retry_reasons` JSONB merge inside `increment_provider_usage`. Deliberately
 * outside `tests/` and never invoked by `npm run test` (same discipline as
 * scripts/verify-strategy-lock.ts and scripts/verify-maintenance-lock.ts).
 *
 * This specifically exercises the part that's easy to get subtly wrong:
 * `jsonb_set` does not auto-create missing intermediate objects, so the
 * function must first ensure `retry_reasons[reason]` exists as an object
 * before setting `retry_reasons[reason][path]` — this script proves that
 * actually works against real Postgres, not just by reading the SQL.
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

async function increment(retryReasons: Record<string, Record<string, number>>): Promise<void> {
  const { error } = await supabase.rpc("increment_provider_usage", {
    p_date: THROWAWAY_DATE,
    p_provider: THROWAWAY_PROVIDER,
    p_outbound_attempts: 1,
    p_retry_reasons: retryReasons,
  });
  if (error) throw new Error(`increment_provider_usage: ${error.message}`);
}

async function readRetryReasons(): Promise<Record<string, Record<string, number>>> {
  const { data, error } = await supabase
    .from("provider_usage_daily")
    .select("retry_reasons")
    .eq("usage_date", THROWAWAY_DATE)
    .eq("provider", THROWAWAY_PROVIDER)
    .maybeSingle();
  if (error) throw new Error(`reading retry_reasons: ${error.message}`);
  return (data?.retry_reasons as Record<string, Record<string, number>>) ?? {};
}

async function main(): Promise<void> {
  // Clean slate.
  await supabase.from("provider_usage_daily").delete().eq("usage_date", THROWAWAY_DATE).eq("provider", THROWAWAY_PROVIDER);

  console.log("1. First increment creates a brand-new nested reason -> path -> count structure from '{}':");
  await increment({ rate_limited: { "/defi/price": 2 } });
  let reasons = await readRetryReasons();
  check("rate_limited./defi/price is 2", reasons.rate_limited?.["/defi/price"] === 2);

  console.log("\n2. A second increment adds to an EXISTING (reason, path) pair rather than overwriting it:");
  await increment({ rate_limited: { "/defi/price": 3 } });
  reasons = await readRetryReasons();
  check("rate_limited./defi/price is now 5 (2 + 3)", reasons.rate_limited?.["/defi/price"] === 5);

  console.log("\n3. Adding a NEW path under an EXISTING reason preserves the old path's count:");
  await increment({ rate_limited: { "/wallet/v2/trade-data/single": 1 } });
  reasons = await readRetryReasons();
  check("rate_limited./defi/price is still 5", reasons.rate_limited?.["/defi/price"] === 5);
  check("rate_limited./wallet/v2/trade-data/single is 1", reasons.rate_limited?.["/wallet/v2/trade-data/single"] === 1);

  console.log("\n4. Adding a brand-new REASON preserves every existing reason's data:");
  await increment({ network_error: { "/defi/price": 7 } });
  reasons = await readRetryReasons();
  check("network_error./defi/price is 7", reasons.network_error?.["/defi/price"] === 7);
  check("rate_limited./defi/price is still 5 after adding a sibling reason", reasons.rate_limited?.["/defi/price"] === 5);
  check("rate_limited./wallet/v2/trade-data/single is still 1", reasons.rate_limited?.["/wallet/v2/trade-data/single"] === 1);

  console.log("\n5. An increment with an EMPTY retry_reasons object is a correct no-op:");
  await increment({});
  reasons = await readRetryReasons();
  check("nothing changed after an empty-object increment", reasons.rate_limited?.["/defi/price"] === 5 && reasons.network_error?.["/defi/price"] === 7);

  console.log("\n6. Cleaning up the throwaway row...");
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
