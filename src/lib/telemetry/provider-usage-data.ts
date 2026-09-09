import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getUtcDateString,
  mergeCounts,
  emptyCounts,
  type ProviderName,
  type ProviderUsageCounts,
  type StoredProviderUsage,
} from "./provider-usage";

// Per-process fallback when Supabase isn't configured — mirrors
// src/lib/cache/api-cache.ts's own memoryCache pattern exactly (same
// reasoning: keeps working before a Supabase project exists, resets on
// restart, single-process only).
const memoryUsage = new Map<string, StoredProviderUsage>();

/**
 * Records provider-usage counters. Awaited (not fire-and-forget) so a write
 * is attempted to completion before the caller proceeds — but every error,
 * whether thrown or returned as `{ error }` (supabase-js resolves rather
 * than throwing on a PostgREST-level failure — see src/lib/supabase/
 * assert.ts's own doc comment on this exact gotcha), is caught here and
 * never rethrown. This function can never reject.
 *
 * Best-effort, not a durable guarantee: a process crash between a provider
 * call finishing and this write completing, or a persistently-unreachable
 * Supabase project, silently loses that increment by design — there is no
 * outbox/retry-on-failure mechanism. `console.error` on failure exists
 * purely for local developer visibility; it does not affect control flow.
 */
export async function recordProviderUsage(provider: ProviderName, counts: ProviderUsageCounts): Promise<void> {
  const date = getUtcDateString();
  const supabase = getSupabaseServiceClient();

  if (!supabase) {
    const key = `${date}:${provider}`;
    memoryUsage.set(key, mergeCounts(memoryUsage.get(key), counts));
    return;
  }

  try {
    const { error } = await supabase.rpc("increment_provider_usage", {
      p_date: date,
      p_provider: provider,
      p_outbound_attempts: counts.outboundAttempts ?? 0,
      p_successful_requests: counts.successfulRequests ?? 0,
      p_retries: counts.retries ?? 0,
      p_cache_hits: counts.cacheHits ?? 0,
      p_cache_misses: counts.cacheMisses ?? 0,
    });
    if (error) {
      console.error(`recordProviderUsage(${provider}): ${error.message}`);
    }
  } catch (err) {
    console.error(`recordProviderUsage(${provider}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface TodayProviderUsage {
  provider: ProviderName;
  usage: StoredProviderUsage;
}

const TRACKED_PROVIDERS: ProviderName[] = ["birdeye", "helius"];

/** Read-only, for the /settings panel — zero provider calls, pure DB read (or in-memory read when Supabase isn't configured). */
export async function getTodayProviderUsage(): Promise<TodayProviderUsage[]> {
  const date = getUtcDateString();
  const supabase = getSupabaseServiceClient();

  if (!supabase) {
    return TRACKED_PROVIDERS.map((provider) => ({
      provider,
      usage: memoryUsage.get(`${date}:${provider}`) ?? emptyCounts(),
    }));
  }

  const { data } = await supabase
    .from("provider_usage_daily")
    .select("provider, outbound_attempts, successful_requests, retries, cache_hits, cache_misses")
    .eq("usage_date", date);

  const byProvider = new Map((data ?? []).map((r) => [r.provider as string, r]));

  return TRACKED_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      usage: row
        ? {
            outboundAttempts: row.outbound_attempts as number,
            successfulRequests: row.successful_requests as number,
            retries: row.retries as number,
            cacheHits: row.cache_hits as number,
            cacheMisses: row.cache_misses as number,
          }
        : emptyCounts(),
    };
  });
}
