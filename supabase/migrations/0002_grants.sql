-- Fixes a real gap found while verifying persistence end-to-end: tables
-- created directly via the SQL Editor don't automatically pick up the
-- privileges Supabase normally pre-configures at project creation, so the
-- app's service-role client got silent "permission denied" on every
-- read/write (silent because Phase 1B persistence is intentionally
-- best-effort — see src/lib/analysis/analyze-wallet.ts). Also covers any
-- future tables created the same way.

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
