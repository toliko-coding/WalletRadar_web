import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getObservationsForToken } from "./observations-data";
import { toRelativeObservations, needsMoreObservations, HORIZON_DEFINITIONS } from "./horizons";

// Longer than the widest horizon window (24h's own max bound is 1800min =
// 30h) so a candidate evaluation is never excluded from consideration just
// because its own horizon window hasn't technically closed yet.
const BACKFILL_LOOKBACK_HOURS = Math.ceil(Math.max(...HORIZON_DEFINITIONS.map((h) => h.maxAcceptableMinutes)) / 60);

export interface MintNeedingBackfill {
  tokenMint: string;
  tokenSymbol: string | null;
}

/**
 * Finds distinct token mints that still have at least one open,
 * unresolved horizon window across ANY strategy's evaluations (global, not
 * scoped to one strategy — token_market_data is a shared ledger, so a
 * single price fetch here can resolve gaps for every strategy that's ever
 * evaluated an event on that token, not just the one whose tick happens to
 * run this step). Capped by the caller; this function itself does no
 * capping beyond `maxMints`, and does not attempt to prioritize by
 * soonest-to-age-out — deliberately simple given the current low signal
 * volume, revisit if that stops being true. Zero provider calls — every
 * read here is a Supabase-only query.
 */
export async function findMintsNeedingBackfill(nowIso: string, maxMints: number): Promise<MintNeedingBackfill[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];

  const cutoff = new Date(new Date(nowIso).getTime() - BACKFILL_LOOKBACK_HOURS * 60 * 60_000).toISOString();

  const { data } = await supabase
    .from("demo_signal_evaluations")
    .select("evaluated_at, convergence_events!inner(token_mint, token_symbol)")
    .neq("decision", "SKIPPED_PREDATES_STRATEGY")
    .gte("evaluated_at", cutoff);

  const rows = (data ?? []) as unknown as Array<{
    evaluated_at: string;
    convergence_events: { token_mint: string; token_symbol: string | null };
  }>;
  if (rows.length === 0) return [];

  const byMint = new Map<string, { tokenSymbol: string | null; evaluatedAts: string[] }>();
  for (const row of rows) {
    const mint = row.convergence_events.token_mint;
    const entry = byMint.get(mint) ?? { tokenSymbol: row.convergence_events.token_symbol, evaluatedAts: [] };
    entry.evaluatedAts.push(row.evaluated_at);
    byMint.set(mint, entry);
  }

  const result: MintNeedingBackfill[] = [];
  for (const [tokenMint, { tokenSymbol, evaluatedAts }] of byMint) {
    if (result.length >= maxMints) break;

    const earliestEvaluatedAt = evaluatedAts.reduce((a, b) => (a < b ? a : b));
    const observationRows = await getObservationsForToken(tokenMint, earliestEvaluatedAt);

    const stillNeeds = evaluatedAts.some((evaluatedAt) =>
      needsMoreObservations(evaluatedAt, toRelativeObservations(observationRows, evaluatedAt), nowIso)
    );
    if (stillNeeds) result.push({ tokenMint, tokenSymbol });
  }

  return result;
}
