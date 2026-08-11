import { z } from "zod";

/**
 * Server-only environment. Importing this file from a Client Component is a
 * build error because it lives outside any "use client" boundary and reads
 * `process.env` directly — never re-export these values to the client.
 */
const serverEnvSchema = z.object({
  BIRDEYE_API_KEY: z.string().optional().default(""),
  HELIUS_API_KEY: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  DATABASE_URL: z.string().optional().default(""),
  HELIUS_WEBHOOK_AUTH_HEADER: z.string().optional().default(""),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional().default(""),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().default(""),
  NEXT_PUBLIC_APP_URL: z.string().optional().default("http://localhost:3000"),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const env = parsed.data;

/** A value is "unset" if empty or still the create-next-app placeholder text. */
function isPlaceholder(value: string): boolean {
  return value.trim() === "" || value.trim().toLowerCase().startsWith("your_");
}

export function isBirdeyeConfigured(): boolean {
  return !isPlaceholder(env.BIRDEYE_API_KEY);
}

export function isHeliusConfigured(): boolean {
  return !isPlaceholder(env.HELIUS_API_KEY);
}

export function isSupabaseConfigured(): boolean {
  return (
    !isPlaceholder(env.NEXT_PUBLIC_SUPABASE_URL) &&
    !isPlaceholder(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

/** Throws a clear, actionable error at call time (not at module load). */
export function requireBirdeyeApiKey(): string {
  if (!isBirdeyeConfigured()) {
    throw new Error(
      "BIRDEYE_API_KEY is not set. Add a real key to .env.local (see .env.example)."
    );
  }
  return env.BIRDEYE_API_KEY;
}

export function requireHeliusApiKey(): string {
  if (!isHeliusConfigured()) {
    throw new Error(
      "HELIUS_API_KEY is not set. Add a real key to .env.local (see .env.example)."
    );
  }
  return env.HELIUS_API_KEY;
}
