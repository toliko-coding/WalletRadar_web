import "server-only";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Soft protection for internal job endpoints (§59). If INTERNAL_JOB_SECRET
 * is set, the caller must send a matching x-job-secret header. If it isn't
 * set, requests are allowed through — there's no auth system yet (Phase 2)
 * to do better, and no public deployment yet for this to matter in practice.
 * Set INTERNAL_JOB_SECRET before deploying anywhere reachable from the
 * internet, and use the same value in the Supabase Cron HTTP request (see
 * supabase/CRON.md).
 */
export function isJobRequestAuthorized(request: NextRequest): boolean {
  const secret = env.INTERNAL_JOB_SECRET;
  if (!secret) return true;
  return request.headers.get("x-job-secret") === secret;
}
