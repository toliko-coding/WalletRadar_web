import { getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Generic cache in front of provider calls (§47) to cut Birdeye/Helius usage.
 * Backed by the `api_cache` table when Supabase is configured; falls back to
 * an in-memory Map (per server instance, cleared on restart) otherwise, so
 * the app still works before a Supabase project exists.
 */
const memoryCache = new Map<string, { payload: unknown; expiresAt: number }>();

export async function cached<T>(
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const supabase = getSupabaseServiceClient();

  if (!supabase) {
    const hit = memoryCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.payload as T;
    }
    const value = await fetcher();
    memoryCache.set(cacheKey, { payload: value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return value;
  }

  const { data: row } = await supabase
    .from("api_cache")
    .select("payload, expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (row && new Date(row.expires_at).getTime() > Date.now()) {
    return row.payload as T;
  }

  const value = await fetcher();
  await supabase.from("api_cache").upsert({
    cache_key: cacheKey,
    payload: value as object,
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
  return value;
}
