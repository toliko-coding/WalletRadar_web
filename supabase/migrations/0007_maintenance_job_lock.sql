-- Automatic Evidence Collection Corrective Phase v2: a single GLOBAL lease
-- lock shared by all three maintenance jobs (discover-wallets,
-- analyze-candidate-wallets, analyze-refresh-wallets). Deliberately one
-- singleton row, not one row per job name: the new runner architecture's own
-- invariant is "only ONE maintenance job of ANY type in flight at a time"
-- (a single serialized maintenanceLoop), so one lock suffices — it exists
-- specifically to protect against what that loop's own sequencing cannot
-- see: a manual curl/browser trigger against one of the three job routes
-- while the loop is mid-job on a different one, or (in principle) a second
-- runner process. Same pool-safe reasoning as strategy_tick_locks (migration
-- 0006) and increment_provider_usage (migration 0005): every operation below
-- is a plain, independent, atomic SQL statement against a durable row, safe
-- under Supabase/PostgREST's connection pooling by construction.
create table maintenance_job_lock (
  id text primary key default 'singleton' check (id = 'singleton'),
  owner_id text not null,
  current_job_name text not null,
  locked_at timestamptz not null,
  locked_until timestamptz not null
);

-- Lease default: 12 hours (43,200s) — conservative, not tuned to typical
-- duration. Real discovery/analyze runs observed this project have taken up
-- to ~300 minutes (5h) under real network conditions (see the Corrective
-- Phase audit), and Birdeye requests currently have no client-side timeout
-- (no AbortController anywhere in src/lib/providers — a hung request has no
-- deadline), so a shorter lease risked a legitimate job losing its lease
-- mid-run. 12h is a starting value, not a guarantee: no finite lease can
-- guarantee exclusivity if a job genuinely exceeds it, and no lease-renewal/
-- heartbeat-extension mechanism exists in this phase. A process that
-- crashes mid-job without reaching its `finally` release therefore blocks
-- every maintenance job type for up to 12h before the next
-- acquire_maintenance_job_lock call recovers it automatically (lazy
-- recovery, no reaper/cleanup job needed) — this is accepted, intentionally
-- visible behavior (see AutomationPanel's lock-status display), not hidden.
create or replace function acquire_maintenance_job_lock(
  p_owner_id text,
  p_job_name text,
  p_lease_seconds integer default 43200
) returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  insert into maintenance_job_lock (id, owner_id, current_job_name, locked_at, locked_until)
  values ('singleton', p_owner_id, p_job_name, now(), now() + make_interval(secs => p_lease_seconds))
  on conflict (id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return true;
  end if;

  update maintenance_job_lock
    set owner_id = p_owner_id,
        current_job_name = p_job_name,
        locked_at = now(),
        locked_until = now() + make_interval(secs => p_lease_seconds)
  where id = 'singleton'
    and locked_until < now();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Release only if the caller still owns the row — a late release from an
-- already-expired-and-reclaimed lease is a safe no-op, never touches a
-- newer holder's row. Released immediately in `finally` the moment a normal
-- job finishes (success or failure) — the 12h lease only ever matters as the
-- crash-recovery ceiling, never as added latency for a normal run.
create or replace function release_maintenance_job_lock(p_owner_id text) returns void
language sql
as $$
  delete from maintenance_job_lock where id = 'singleton' and owner_id = p_owner_id;
$$;

grant select, insert, update, delete on maintenance_job_lock to service_role;
grant execute on function acquire_maintenance_job_lock to service_role;
grant execute on function release_maintenance_job_lock to service_role;
