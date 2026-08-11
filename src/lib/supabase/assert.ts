import "server-only";

/**
 * supabase-js query builders resolve successfully even when the database
 * rejects the query — the failure lands in `{ error }`, not a thrown
 * exception. Every mutating call in this codebase must check it explicitly;
 * a bare `await supabase.from(...).upsert(...)` silently no-ops on failure
 * while the caller goes on believing it worked. (Found the hard way: a
 * heterogeneous-shape array upsert failed with PGRST102 "All object keys
 * must match" and the discovery job still reported `persisted: true`.)
 */
export function assertNoError(result: { error: { message: string } | null }, context: string): void {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
}
