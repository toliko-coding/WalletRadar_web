-- Provider Usage Telemetry.
--
-- A small daily rollup of Birdeye/Helius usage, replacing "the developer
-- avoids triggering things manually" with an actual number. Deliberately
-- best-effort, not billing-grade: see src/lib/telemetry/provider-usage.ts
-- for the exact delivery semantics (awaited writes with all errors
-- swallowed, so a telemetry failure can never break a real provider call).
--
-- outbound_attempts counts every real HTTP fetch attempt, including
-- retries; successful_requests counts top-level birdeyeRequest()/
-- heliusGet() calls that ultimately resolved (at most one per call,
-- regardless of how many attempts it took); retries is attempts beyond
-- the first for a call. E.g. outbound_attempts=3, successful_requests=1,
-- retries=2 means: it failed twice, then succeeded on the third attempt.
create table provider_usage_daily (
  usage_date date not null,
  provider text not null,
  outbound_attempts integer not null default 0,
  successful_requests integer not null default 0,
  retries integer not null default 0,
  cache_hits integer not null default 0,
  cache_misses integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (usage_date, provider)
);

-- Atomic upsert-increment (§D of the approved plan) — a single INSERT ...
-- ON CONFLICT DO UPDATE statement, so concurrent calls for the same
-- (usage_date, provider) serialize via Postgres's own row-level MVCC
-- locking instead of racing a read-modify-write in application code.
create or replace function increment_provider_usage(
  p_date date,
  p_provider text,
  p_outbound_attempts integer default 0,
  p_successful_requests integer default 0,
  p_retries integer default 0,
  p_cache_hits integer default 0,
  p_cache_misses integer default 0
) returns void
language sql
as $$
  insert into provider_usage_daily
    (usage_date, provider, outbound_attempts, successful_requests, retries, cache_hits, cache_misses, updated_at)
  values
    (p_date, p_provider, p_outbound_attempts, p_successful_requests, p_retries, p_cache_hits, p_cache_misses, now())
  on conflict (usage_date, provider) do update set
    outbound_attempts   = provider_usage_daily.outbound_attempts + excluded.outbound_attempts,
    successful_requests = provider_usage_daily.successful_requests + excluded.successful_requests,
    retries              = provider_usage_daily.retries + excluded.retries,
    cache_hits           = provider_usage_daily.cache_hits + excluded.cache_hits,
    cache_misses         = provider_usage_daily.cache_misses + excluded.cache_misses,
    updated_at           = now();
$$;

-- Same grants gotcha every prior migration in this project has hit:
-- SQL-Editor-created tables/functions don't inherit Supabase's default
-- grants, and supabase-js doesn't throw on a PostgREST permission error —
-- see 0002_grants.sql and the comments in 0003/0004.
grant select, insert, update on provider_usage_daily to service_role;
grant execute on function increment_provider_usage to service_role;
