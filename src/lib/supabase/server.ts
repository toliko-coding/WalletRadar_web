import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "@/lib/env";

let cachedClient: SupabaseClient | null | undefined;

/**
 * Service-role Supabase client for server-only code (Route Handlers, jobs).
 * Returns null when no Supabase project is configured yet (§ plan: no
 * project exists this session) so callers can degrade gracefully instead of
 * crashing the whole request.
 */
export function getSupabaseServiceClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  if (!isSupabaseConfigured() || !env.SUPABASE_SERVICE_ROLE_KEY) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
