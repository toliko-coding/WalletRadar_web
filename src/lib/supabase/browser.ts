"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Anon-key Supabase client for Client Components. Only uses NEXT_PUBLIC_*
 * vars — never the service role key. Not used by Phase 1B (the analyzer is
 * server-rendered/fetched), but wired up now so Phase 2 auth doesn't need a
 * new client pattern introduced later.
 */
export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  return createBrowserClient(url, anonKey);
}
