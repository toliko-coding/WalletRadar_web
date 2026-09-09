-- Signal / Strategy Validation schema.
--
-- Separates four concerns that a strategy-owned demo_signals row previously
-- conflated: (A) the underlying real-world convergence event, (B) a
-- particular strategy evaluating that event, (C) whether it traded or
-- skipped it and why, (D) what happened to the token's price afterward.
-- See the approved plan (Signal / Strategy Validation v2) for the full
-- design rationale — summarized here at each table.
--
-- Nothing about the existing trading engine changes: evaluateExit,
-- simulateFill, isSignalEligible, and demo_signals/demo_positions/
-- demo_trades's role in actually running a Demo strategy are untouched.
-- This schema is an additive research/bookkeeping layer alongside it.

-- Every decision a strategy can make about a detected event. SKIPPED_
-- PREDATES_STRATEGY exists purely as a strategy-behavior audit record (proof
-- the strategy correctly refused to backdate itself onto old history) and
-- must be excluded from every signal-quality/strategy-quality statistic —
-- enforced in the application layer (src/lib/validation/*), not here.
create type demo_signal_decision as enum (
  'TRADED',
  'SKIPPED_ALREADY_HOLDING',
  'SKIPPED_MAX_POSITIONS',
  'SKIPPED_ALLOCATION',
  'SKIPPED_INSUFFICIENT_CASH',
  'SKIPPED_RISK_FILTER',
  'SKIPPED_NO_PRICE',
  'SKIPPED_PREDATES_STRATEGY'
);

-- One row per real-world convergence occurrence — strategy-agnostic, the
-- canonical identity multiple strategies' evaluations reference. Not a
-- separately-run detection pass: rows are created/merged opportunistically
-- the first time ANY strategy's tick detects the underlying event via the
-- existing getConvergenceSignals() pipeline (src/lib/smart-money/data.ts).
--
-- Matching/merge rule (see src/lib/validation/events.ts): a new detection
-- for the same token_mint whose signal_time is within +/-60min of an
-- existing row's signal_time is treated as the same event — wallets are
-- unioned (keeping each wallet's earliest known occurredAt), signal_time
-- moves to min(existing, incoming), and min/max/avg smart score are
-- recomputed from the merged union. first_recorded_at never changes after
-- creation and is never used to gate anything (each strategy's own
-- evaluated_at is the forward-only anchor — see demo_signal_evaluations).
--
-- wallet_count/min/max/avg_smart_score describe the UNION of every wallet
-- any strategy has ever attributed to this event — NOT any one strategy's
-- own qualifying subset under its own thresholds (that's
-- demo_signal_evaluations.qualifying_wallet_count).
create table convergence_events (
  id uuid primary key default gen_random_uuid(),
  token_mint text not null,
  token_symbol text,
  signal_time timestamptz not null,
  first_recorded_at timestamptz not null default now(),
  triggering_wallets jsonb not null,
  wallet_count integer not null,
  min_smart_score numeric,
  max_smart_score numeric,
  avg_smart_score numeric,
  market_price_at_first_detection numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index convergence_events_mint_idx on convergence_events (token_mint, signal_time);

-- One row per (strategy, event) pair, EVER — the unique constraint is the
-- fix for a strategy re-detecting the same event on every subsequent tick
-- (getConvergenceSignals is stateless and has no memory of prior
-- detections): the first tick that sees an event decides for that strategy,
-- every later re-detection of the same event by the same strategy is a
-- no-op. This is also the durable record skippedSignals never used to be —
-- previously a skip only ever existed in an in-memory array returned by one
-- tick's HTTP response and was then lost.
--
-- qualifying_wallet_count/qualifying_avg_smart_score are THIS strategy's own
-- filtered view (wallets meeting its own min_smart_score, within its own
-- signal_window_minutes) — distinct from the event's union-wide
-- wallet_count/avg_smart_score above. evaluated_at is the forward-only
-- anchor for horizon matching (src/lib/validation/horizons.ts) — never the
-- event's signal_time or any wallet's historical trade timestamp.
create table demo_signal_evaluations (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references demo_strategies(id) on delete cascade,
  event_id uuid not null references convergence_events(id) on delete cascade,
  decision demo_signal_decision not null,
  qualifying_wallet_count integer not null,
  qualifying_avg_smart_score numeric,
  evaluated_at timestamptz not null,
  demo_signal_id uuid references demo_signals(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (strategy_id, event_id)
);

create index demo_signal_evaluations_strategy_idx on demo_signal_evaluations (strategy_id, evaluated_at);
create index demo_signal_evaluations_event_idx on demo_signal_evaluations (event_id);

-- Purely additive/backward-compatible join shortcut: which canonical event
-- produced a given traded signal, without a hop through
-- demo_signal_evaluations. Null for any demo_signals row written before this
-- migration.
alter table demo_signals add column event_id uuid references convergence_events(id);

-- Same grants pattern 0003 already established — SQL-Editor-created tables
-- don't inherit Supabase's default grants, and this exact gap silently broke
-- writes before (see 0002_grants.sql / 0003's own comment).
grant select, insert, update, delete on
  convergence_events, demo_signal_evaluations
to service_role;
