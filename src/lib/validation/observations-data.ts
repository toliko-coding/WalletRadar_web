import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { assertNoError } from "@/lib/supabase/assert";

export interface RecordObservationInput {
  tokenMint: string;
  tokenSymbol?: string | null;
  /** Null for a liquidity/market-cap-only observation (e.g. from getRiskData, which doesn't fetch price) — such rows are never picked up by horizon-return resolution, which reads price_usd only. */
  priceUsd: number | null;
  liquidityUsd?: number | null;
  marketCapUsd?: number | null;
  volumeUsd?: number | null;
  fetchedAt?: string;
}

/**
 * Repurposes the previously 100%-unused `token_market_data` table as the
 * append-only market observation ledger (plan §D) — a single observation of
 * token T at time t can serve every event/evaluation on that token near
 * that time, rather than duplicating the same market fact per signal.
 *
 * `token_market_data.token_mint` FKs to `tokens(mint)`; `tokens` is
 * otherwise-unused schema too, but its only non-nullable column is `mint`
 * itself, so a minimal upsert here is a genuinely safe, zero-cost way to
 * satisfy the FK without dropping it (per the approved plan's explicit
 * instruction to prefer preserving referential integrity when a minimal
 * upsert is possible — it is, here). This is a pure Supabase write, never a
 * provider call.
 */
export async function recordObservation(input: RecordObservationInput): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;

  const tokenUpsert = await supabase
    .from("tokens")
    .upsert({ mint: input.tokenMint, symbol: input.tokenSymbol ?? null }, { onConflict: "mint", ignoreDuplicates: true });
  assertNoError(tokenUpsert, "ensuring tokens row for market observation");

  const insertResult = await supabase.from("token_market_data").insert({
    token_mint: input.tokenMint,
    price_usd: input.priceUsd,
    liquidity_usd: input.liquidityUsd ?? null,
    market_cap_usd: input.marketCapUsd ?? null,
    volume_24h_usd: input.volumeUsd ?? null,
    fetched_at: input.fetchedAt ?? new Date().toISOString(),
  });
  assertNoError(insertResult, "recording token market observation");
}

export interface StoredObservation {
  priceUsd: number;
  observedAt: string;
}

/**
 * Raw price-bearing observations for one token since a given time — callers
 * convert to evaluation-relative minutes via `toRelativeObservations`
 * (src/lib/validation/horizons.ts) against whichever evaluation's
 * `evaluated_at` they're resolving horizons for. Liquidity/market-cap-only
 * rows (price_usd null, written from getRiskData) are excluded here since
 * they carry no price for horizon-return resolution to use.
 */
export async function getObservationsForToken(tokenMint: string, sinceIso: string): Promise<StoredObservation[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("token_market_data")
    .select("price_usd, fetched_at")
    .eq("token_mint", tokenMint)
    .not("price_usd", "is", null)
    .gte("fetched_at", sinceIso)
    .order("fetched_at", { ascending: true });

  return (data ?? []).map((r) => ({ priceUsd: r.price_usd as number, observedAt: r.fetched_at as string }));
}
