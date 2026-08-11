import { z } from "zod";

/**
 * Server-only environment. Importing this file from a Client Component is a
 * build error because it lives outside any "use client" boundary and reads
 * `process.env` directly — never re-export these values to the client.
 *
 * Two layers of Zod validation, deliberately:
 *  1. `envSchema` below parses `process.env` once at module load. Every field
 *     is optional here — this layer only guarantees *shape* (all values are
 *     strings), so the app (dashboard shell, status pills, pages that don't
 *     need a given provider) can boot before every provider is configured.
 *  2. `requiredValueSchema` + the `require*` functions below re-validate a
 *     single variable as non-empty/non-placeholder *at the point a code path
 *     actually needs it* (e.g. the moment we're about to call Birdeye). That
 *     throws a specific, actionable error naming the exact variable and how
 *     to fix it — instead of a confusing downstream fetch/auth failure.
 *
 * DATABASE_URL and HELIUS_WEBHOOK_AUTH_HEADER aren't consumed by any code
 * path yet (no direct Postgres access; webhooks are Phase 1G) — they're
 * validated as strings here so the schema names every variable the project
 * uses, but nothing calls a `require*` for them until code actually needs
 * them.
 */
const envSchema = z.object({
  BIRDEYE_API_KEY: z.string().optional().default(""),
  HELIUS_API_KEY: z.string().optional().default(""),
  HELIUS_WEBHOOK_AUTH_HEADER: z.string().optional().default(""),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional().default(""),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional().default(""),
  SUPABASE_SECRET_KEY: z.string().optional().default(""),
  DATABASE_URL: z.string().optional().default(""),
  NEXT_PUBLIC_APP_URL: z.string().optional().default("http://localhost:3000"),
  /** Shared secret for internal job endpoints (§59) — see src/lib/jobs/auth.ts. */
  INTERNAL_JOB_SECRET: z.string().optional().default(""),
});

type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const env: Env = parsed.data;

/** Rejects empty values and the literal placeholder text shipped in .env.example. */
function requiredValueSchema(varName: string) {
  return z
    .string()
    .trim()
    .min(1, `${varName} is not set.`)
    .refine((v) => !v.toLowerCase().startsWith("your_"), {
      message: `${varName} still has its .env.example placeholder value.`,
    });
}

function isConfigured(varName: keyof Env): boolean {
  return requiredValueSchema(varName).safeParse(env[varName]).success;
}

/** Throws a specific, actionable error at call time — never at module load. */
function requireEnvVar(varName: keyof Env): string {
  const result = requiredValueSchema(varName).safeParse(env[varName]);
  if (!result.success) {
    const reason = result.error.issues[0]?.message ?? `${varName} is invalid.`;
    throw new Error(`${reason} Add a real value to .env.local (see .env.example).`);
  }
  return result.data;
}

export function isBirdeyeConfigured(): boolean {
  return isConfigured("BIRDEYE_API_KEY");
}

export function isHeliusConfigured(): boolean {
  return isConfigured("HELIUS_API_KEY");
}

export function isSupabaseConfigured(): boolean {
  return isConfigured("NEXT_PUBLIC_SUPABASE_URL") && isConfigured("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function requireBirdeyeApiKey(): string {
  return requireEnvVar("BIRDEYE_API_KEY");
}

export function requireHeliusApiKey(): string {
  return requireEnvVar("HELIUS_API_KEY");
}

export function requireSupabaseUrl(): string {
  return requireEnvVar("NEXT_PUBLIC_SUPABASE_URL");
}

export function requireSupabasePublishableKey(): string {
  return requireEnvVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function requireSupabaseSecretKey(): string {
  return requireEnvVar("SUPABASE_SECRET_KEY");
}
