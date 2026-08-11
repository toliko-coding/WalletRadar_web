import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "@/lib/env";

let cachedClient: SupabaseClient | null | undefined;

/**
 * Secret-key Supabase client for server-only code (Route Handlers, jobs).
 * Returns null when no Supabase project is configured yet (no project exists
 * this session) so callers can degrade gracefully instead of crashing the
 * whole request — this is the one intentional exception to fail-fast env
 * validation, because persistence throughout Phase 1B is documented as
 * best-effort (see src/lib/analysis/analyze-wallet.ts).
 */
export function getSupabaseServiceClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const secretKeyConfigured = env.SUPABASE_SECRET_KEY.trim().length > 0;
  if (!isSupabaseConfigured() || !secretKeyConfigured) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
