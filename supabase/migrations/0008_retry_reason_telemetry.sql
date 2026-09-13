-- Corrective Phase v2, Objective 3: the SMALLEST useful addition to
-- diagnose the observed ~45-50% Birdeye retry rate — current telemetry
-- (migration 0005) only has an aggregate retry COUNT, with no information
-- on WHY attempts failed (429 vs 5xx vs a genuine network failure vs a
-- malformed response) or WHICH endpoint. This is deliberately a single
-- compact JSONB counter, not a per-request log table: shape is
-- { [reason]: { [path]: count } }, bounded by (a handful of reason
-- categories) x (a handful of distinct Birdeye/Helius endpoints) — never
-- grows per-request. This migration adds ONLY the telemetry column/merge
-- logic; it does not change retry counts, backoff, retryability, or add
-- request timeouts — see src/lib/rate-limit/token-bucket.ts's `onRetry` (a
-- pure observer callback, zero effect on retry decisions).
alter table provider_usage_daily
  add column retry_reasons jsonb not null default '{}'::jsonb;

-- IMPORTANT: `create or replace function` does NOT replace an existing
-- function whose argument list differs — in Postgres, a function's
-- identity includes its parameter type list, not just its name, so adding
-- an 8th parameter here would leave migration 0005's original 7-argument
-- increment_provider_usage(date, text, integer, integer, integer, integer,
-- integer) in place as a SEPARATE overload, alongside this new 8-argument
-- one. Two overloads of the same RPC name is exactly the kind of ambiguity
-- PostgREST cannot always resolve. The old 7-argument signature is
-- therefore dropped explicitly first, so there is only ever ONE
-- increment_provider_usage function after this migration runs — the new
-- 8-argument one, whose `p_retry_reasons` parameter has a default, so a
-- caller that only ever passed the original 7 named arguments (there are
-- none left in this codebase, but this keeps the RPC name itself
-- backward-compatible in shape) still works unchanged.
drop function if exists increment_provider_usage(
  date,
  text,
  integer,
  integer,
  integer,
  integer,
  integer
);

-- Rewritten as plpgsql (was plain sql in migration 0005) because merging a
-- nested map needs a loop; still one row-locked read + one write per call,
-- matching the same concurrency-safety reasoning as every prior migration's
-- atomic upsert.
create function increment_provider_usage(
  p_date date,
  p_provider text,
  p_outbound_attempts integer default 0,
  p_successful_requests integer default 0,
  p_retries integer default 0,
  p_cache_hits integer default 0,
  p_cache_misses integer default 0,
  p_retry_reasons jsonb default '{}'::jsonb
) returns void
language plpgsql
as $$
declare
  v_reason text;
  v_path_counts jsonb;
  v_path text;
  v_count integer;
  v_merged jsonb;
begin
  insert into provider_usage_daily
    (usage_date, provider, outbound_attempts, successful_requests, retries, cache_hits, cache_misses, retry_reasons, updated_at)
  values
    (p_date, p_provider, p_outbound_attempts, p_successful_requests, p_retries, p_cache_hits, p_cache_misses, '{}'::jsonb, now())
  on conflict (usage_date, provider) do update set
    outbound_attempts   = provider_usage_daily.outbound_attempts + excluded.outbound_attempts,
    successful_requests = provider_usage_daily.successful_requests + excluded.successful_requests,
    retries              = provider_usage_daily.retries + excluded.retries,
    cache_hits           = provider_usage_daily.cache_hits + excluded.cache_hits,
    cache_misses         = provider_usage_daily.cache_misses + excluded.cache_misses,
    updated_at           = now();

  if p_retry_reasons is null or p_retry_reasons = '{}'::jsonb then
    return;
  end if;

  -- Row-locked read of the current nested map, merged in memory, written
  -- back once — jsonb_set does not auto-create missing intermediate
  -- objects, so each reason's own sub-object is ensured to exist (as a
  -- single-level set into the already-existing top-level v_merged, which
  -- IS supported) before setting the nested [reason][path] count.
  select retry_reasons into v_merged
    from provider_usage_daily
    where usage_date = p_date and provider = p_provider
    for update;
  v_merged := coalesce(v_merged, '{}'::jsonb);

  for v_reason, v_path_counts in select * from jsonb_each(p_retry_reasons)
  loop
    if not (v_merged ? v_reason) then
      v_merged := jsonb_set(v_merged, array[v_reason], '{}'::jsonb, true);
    end if;
    for v_path, v_count in select key, value::integer from jsonb_each_text(v_path_counts)
    loop
      v_merged := jsonb_set(
        v_merged,
        array[v_reason, v_path],
        to_jsonb(coalesce((v_merged #>> array[v_reason, v_path])::integer, 0) + v_count),
        true
      );
    end loop;
  end loop;

  update provider_usage_daily set retry_reasons = v_merged
    where usage_date = p_date and provider = p_provider;
end;
$$;

-- Qualified with the exact new signature rather than the bare function
-- name — after the drop above there is only one candidate, but being
-- explicit here avoids ever depending on "there happens to be only one
-- overload" being true.
grant execute on function increment_provider_usage(
  date,
  text,
  integer,
  integer,
  integer,
  integer,
  integer,
  jsonb
) to service_role;
