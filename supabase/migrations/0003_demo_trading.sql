-- WalletRadar Phase 1I/1J schema: Demo / Paper Trading (§26-43).
-- Entirely virtual — no real funds, no real transactions. See
-- src/lib/demo/engine.ts for the anti-look-ahead safeguards (§30/§39) this
-- schema exists to support: entry price is always the price at DETECTION
-- time, never the source wallet's historical price, and a strategy only
-- ever reacts to signals detected after its own created_at.

create type demo_strategy_status as enum ('ACTIVE', 'PAUSED');
create type demo_position_status as enum ('OPEN', 'CLOSED');
create type demo_trade_action as enum ('BUY', 'SELL');
create type demo_exit_rule as enum (
  'STOP_LOSS',
  'TAKE_PROFIT',
  'MAX_HOLDING_PERIOD',
  'FOLLOW_SMART_EXIT',
  'SMART_MONEY_REVERSAL',
  'MANUAL'
);

-- One row per configured paper-trading strategy (§28). Multiple strategies
-- can run side by side so different discovery/convergence criteria can be
-- compared against each other (§38) without ever mixing their results.
create table demo_strategies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status demo_strategy_status not null default 'ACTIVE',
  starting_capital_usd numeric not null,

  -- Which convergence signals this strategy reacts to (mirrors
  -- src/lib/smart-money/detect-convergence.ts's ConvergenceCriteria).
  min_smart_score numeric not null default 0,
  min_wallets_required integer not null default 2,
  signal_window_minutes integer not null default 180,

  -- Position sizing / risk (§28).
  virtual_buy_size_usd numeric not null default 100,
  max_open_positions integer not null default 10,
  max_allocation_pct_per_token numeric not null default 10,

  -- Exit rules (§33) — nullable means "not used". V1 evaluates
  -- STOP_LOSS/TAKE_PROFIT/MAX_HOLDING_PERIOD only (see engine.ts);
  -- FOLLOW_SMART_EXIT/SMART_MONEY_REVERSAL need Phase 1G/1H data this
  -- project doesn't have continuously yet, so they're modeled but inert.
  stop_loss_pct numeric,
  take_profit_pct numeric,
  max_position_age_hours numeric,

  -- Realism controls (§31/§32) — never pretend a fill is free/instant.
  simulated_slippage_pct numeric not null default 0.5,
  fee_pct numeric not null default 0,

  -- Token risk filters (§43) — optional; null means "no filter".
  min_token_liquidity_usd numeric,
  min_market_cap_usd numeric,
  max_market_cap_usd numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1:1 with demo_strategies today, kept as its own table (rather than columns
-- on demo_strategies) because the spec models account state and strategy
-- configuration as separate concerns (§45) — e.g. resetting an account
-- shouldn't require recreating the strategy's configuration.
create table demo_accounts (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null unique references demo_strategies(id) on delete cascade,
  cash_balance_usd numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per convergence signal a strategy actually acted on (§34/§40).
-- triggering_wallets is a snapshot of the ConvergenceSignal that fired this,
-- kept as jsonb so "why did this trade happen" is always reconstructable
-- even if the underlying wallet_trades rows are later pruned.
create table demo_signals (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references demo_strategies(id) on delete cascade,
  token_mint text not null,
  token_symbol text,
  triggering_wallets jsonb not null,
  average_smart_score numeric,
  wallet_count integer not null,
  signal_time timestamptz not null, -- earliest qualifying on-chain buy among triggering wallets
  detection_time timestamptz not null, -- when WalletRadar's evaluate-demo-entries job saw it
  market_price_at_detection numeric,
  created_at timestamptz not null default now()
);

create index demo_signals_strategy_idx on demo_signals (strategy_id, detection_time desc);

-- Open/closed paper positions (§34/§41).
create table demo_positions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references demo_strategies(id) on delete cascade,
  signal_id uuid not null references demo_signals(id) on delete cascade,
  token_mint text not null,
  token_symbol text,
  status demo_position_status not null default 'OPEN',

  entry_price numeric not null, -- includes simulated slippage — see engine.ts
  quantity numeric not null,
  position_size_usd numeric not null,
  entry_time timestamptz not null,

  stop_loss_price numeric,
  take_profit_price numeric,
  max_position_age_hours numeric,

  exit_rule demo_exit_rule,
  exit_time timestamptz,
  exit_price numeric,
  fees_usd numeric not null default 0,
  gross_pnl_usd numeric,
  net_pnl_usd numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index demo_positions_strategy_idx on demo_positions (strategy_id, status);

-- Immutable trade log — one row per simulated buy or sell (§34/§40). A
-- position has exactly one BUY row and, once closed, exactly one SELL row.
create table demo_trades (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references demo_strategies(id) on delete cascade,
  position_id uuid not null references demo_positions(id) on delete cascade,
  signal_id uuid references demo_signals(id) on delete set null,
  action demo_trade_action not null,
  token_mint text not null,
  token_symbol text,
  reference_market_price numeric not null, -- price observed before slippage
  execution_price numeric not null, -- price actually used, after simulated slippage
  simulated_slippage_pct numeric not null,
  quantity numeric not null,
  usd_value numeric not null,
  fees_usd numeric not null default 0,
  gross_pnl_usd numeric, -- set on SELL rows only
  net_pnl_usd numeric, -- set on SELL rows only
  executed_at timestamptz not null default now()
);

create index demo_trades_strategy_idx on demo_trades (strategy_id, executed_at desc);

-- Periodic mark-to-market snapshots — the equity curve (§35/§36) is built
-- from these, never reconstructed from current positions alone.
create table demo_portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references demo_strategies(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  cash_balance_usd numeric not null,
  open_position_value_usd numeric not null,
  total_value_usd numeric not null,
  realized_pnl_usd numeric not null,
  unrealized_pnl_usd numeric not null,
  total_pnl_usd numeric not null,
  roi_pct numeric not null
);

create index demo_portfolio_snapshots_strategy_idx on demo_portfolio_snapshots (strategy_id, snapshot_at);

-- Benchmark price snapshots for comparison (§37) — SOL/BTC, opportunistically
-- recorded alongside portfolio snapshots rather than polled continuously.
create table benchmarks (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  price_usd numeric not null,
  recorded_at timestamptz not null default now()
);

create index benchmarks_symbol_idx on benchmarks (symbol, recorded_at);

-- Without this, every write from the app's service-role client silently
-- fails (PostgREST returns { error }, which supabase-js does not throw —
-- see src/lib/supabase/assert.ts and 0002_grants.sql, the exact issue this
-- caused for the discovery tables before it was caught by direct
-- inspection). Tables created via the SQL Editor don't automatically pick
-- up the grants Supabase pre-configures at project creation.
grant select, insert, update, delete on
  demo_strategies, demo_accounts, demo_signals, demo_positions, demo_trades,
  demo_portfolio_snapshots, benchmarks
to service_role;
