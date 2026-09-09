-- Automatic Evidence Collection: DB-backed expiring strategy lease + a
-- singleton runner-heartbeat row. See the approved Automatic Evidence
-- Collection plan for full rationale; summarized at each object below.
--
-- Deliberately NOT pg_try_advisory_lock/pg_advisory_unlock: those are
-- session-scoped, and Supabase/PostgREST RPC calls go through a connection
-- pool (PgBouncer/Supavisor) with no guarantee an acquire and its matching
-- release run on the same physical Postgres connection. Every operation
-- here is instead a plain, independent, atomic SQL statement against a
-- durable row — safe under pooling by construction, no connection affinity
-- required, the same reasoning increment_provider_usage (migration 0005)
-- already relies on.

-- One row per strategy currently (or recently) being ticked. Absence of a
-- row, or a row whose lease has expired, both mean "free to acquire."
create table strategy_tick_locks (
  strategy_id uuid primary key references demo_strategies(id) on delete cascade,
  owner_id text not null,
  locked_at timestamptz not null,
  locked_until timestamptz not null
);

-- Atomic acquire: try a fresh insert first (no row exists yet); if that
-- conflicts, only take the row over if its lease has already expired. Both
-- statements are individually atomic upserts/updates, so concurrent callers
-- racing the same strategy_id are serialized by Postgres's own row-level
-- locking on the conflicting key — nothing here manages concurrency itself.
--
-- Lease default: 300 seconds (5 minutes). A real tick with one signal/one
-- position observed this session completed in 3-5 seconds end to end, but
-- the lease is sized for a worse case, not the typical one: a tick can
-- touch multiple open positions' price lookups plus the bounded
-- observation-backfill step, each individually subject to withRetry's up
-- to 3 retries with exponential backoff, all serialized behind Birdeye's
-- 1rps TokenBucket — several sequential, individually-retrying, rate-
-- limited calls in one tick can plausibly stack up to a couple of minutes
-- under real network conditions. 300s is a conservative operational value
-- based on current observed/request characteristics, not a guarantee —
-- without lease renewal (not implemented in this phase), no finite lease
-- can guarantee a legitimate tick never loses it. Revisit once real
-- automated tick durations are actually observed.
create or replace function acquire_strategy_tick_lock(
  p_strategy_id uuid,
  p_owner_id text,
  p_lease_seconds integer default 300
) returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  insert into strategy_tick_locks (strategy_id, owner_id, locked_at, locked_until)
  values (p_strategy_id, p_owner_id, now(), now() + make_interval(secs => p_lease_seconds))
  on conflict (strategy_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return true;
  end if;

  update strategy_tick_locks
    set owner_id = p_owner_id,
        locked_at = now(),
        locked_until = now() + make_interval(secs => p_lease_seconds)
  where strategy_id = p_strategy_id
    and locked_until < now();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Release only if the caller still owns the row — a late release from an
-- already-expired-and-reclaimed lease is a safe no-op, never touches a
-- newer holder's row. If a process crashes before ever calling this, the
-- row simply sits until its lease naturally expires; the next
-- acquire_strategy_tick_lock call for that strategy recovers it
-- automatically — no reaper/cleanup job needed.
create or replace function release_strategy_tick_lock(p_strategy_id uuid, p_owner_id text) returns void
language sql
as $$
  delete from strategy_tick_locks where strategy_id = p_strategy_id and owner_id = p_owner_id;
$$;

-- Singleton heartbeat row the standalone automation runner reports into.
-- This is a health/observability signal only — never the authority for
-- whether a second runner process is allowed to start (that decision is
-- entirely local: a lock file + a live, matching PID on the same machine —
-- see automation/cli.ts). A runner can legitimately be alive and correctly
-- ticking while this row goes stale (e.g. Next.js/Supabase briefly
-- unreachable), which must never be misread as "no runner is running."
create table automation_runner_status (
  id text primary key default 'singleton' check (id = 'singleton'),
  runner_id text,
  pid integer,
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  last_cycle_completed_at timestamptz,
  last_cycle_status text,
  last_error text,
  tick_interval_minutes integer,
  discovery_interval_hours integer,
  analyze_interval_hours integer,
  analyze_batch_size integer,
  expensive_job_daily_budget integer,
  updated_at timestamptz not null default now()
);

-- Same grants gotcha every prior migration in this project has needed —
-- SQL-Editor-created tables/functions don't inherit Supabase's default
-- grants, and supabase-js resolves with `{ error }` rather than throwing on
-- a PostgREST permission error (see 0002_grants.sql and 0003/0004/0005's
-- own comments on this exact issue).
grant select, insert, update, delete on strategy_tick_locks to service_role;
grant execute on function acquire_strategy_tick_lock to service_role;
grant execute on function release_strategy_tick_lock to service_role;
grant select, insert, update on automation_runner_status to service_role;
