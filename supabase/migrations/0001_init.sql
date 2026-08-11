-- WalletRadar Phase 1A schema.
-- Run against a Supabase/Postgres project via `supabase db push` (see README).
-- Only the tables needed by the foundation + manual wallet analyzer (Phase 1B)
-- are created here. Discovery/scoring-history, smart-money, and demo-trading
-- tables are added in later migrations as those phases are built, so schema
-- growth stays incremental instead of one large speculative migration.

create extension if not exists pgcrypto;

-- Every financial figure that isn't on-chain-exact carries a reliability tag (§50).
create type data_reliability as enum (
  'EXACT',
  'ON_CHAIN',
  'PROVIDER_CALCULATED',
  'CALCULATED',
  'ESTIMATED',
  'UNAVAILABLE'
);

create type transaction_type as enum (
  'DEX_SWAP_BUY',
  'DEX_SWAP_SELL',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'AIRDROP',
  'STAKE',
  'LP_ACTION',
  'UNKNOWN'
);

create type risk_level as enum ('LOW', 'MEDIUM', 'HIGH');

create type trader_type as enum (
  'SMART_TRADER',
  'MANUAL_UNKNOWN',
  'BOT_SUSPECTED',
  'SNIPER',
  'INSIDER_TAGGED',
  'DEVELOPER',
  'BUNDLER'
);

create type analysis_status as enum ('pending', 'analyzing', 'analyzed', 'failed');

-- Canonical wallet record.
create table wallets (
  address text primary key,
  first_seen_at timestamptz not null default now(),
  tags text[] not null default '{}',
  risk_level risk_level,
  trader_type trader_type not null default 'MANUAL_UNKNOWN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Discovery queue — every wallet WalletRadar has ever seen as a candidate (§5).
create table candidate_wallets (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique references wallets(address) on delete cascade,
  first_discovered_at timestamptz not null default now(),
  last_discovered_at timestamptz not null default now(),
  discovery_source text not null,
  number_of_discovery_hits integer not null default 1,
  tokens_discovered_from text[] not null default '{}',
  analysis_status analysis_status not null default 'pending',
  last_analyzed_at timestamptz,
  last_processed_signature text,
  eligible boolean,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index candidate_wallets_status_idx on candidate_wallets (analysis_status);

-- Latest computed metrics snapshot per wallet, scoped to an analysis window.
create table wallet_metrics (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references wallets(address) on delete cascade,
  window_label text not null,
  realized_pnl_usd numeric,
  realized_pnl_reliability data_reliability not null default 'UNAVAILABLE',
  unrealized_pnl_usd numeric,
  unrealized_pnl_reliability data_reliability not null default 'UNAVAILABLE',
  total_pnl_usd numeric,
  roi_pct numeric,
  win_rate_pct numeric,
  trade_count integer not null default 0,
  volume_usd numeric,
  avg_trade_size_usd numeric,
  avg_hold_duration_hours numeric,
  max_drawdown_pct numeric,
  wallet_age_days integer,
  trading_history_days integer,
  last_activity_at timestamptz,
  profit_concentration_pct numeric,
  profit_concentration_token_symbol text,
  risk_level risk_level,
  trader_type trader_type,
  smart_score numeric,
  smart_score_breakdown jsonb,
  computed_at timestamptz not null default now(),
  unique (wallet_address, window_label)
);

-- Append-only time series of the above, so score-vs-outcome analysis (§44/§62) is possible later.
create table wallet_metric_history (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references wallets(address) on delete cascade,
  window_label text not null,
  snapshot jsonb not null,
  smart_score numeric,
  snapshot_at timestamptz not null default now()
);

create index wallet_metric_history_wallet_idx on wallet_metric_history (wallet_address, snapshot_at desc);

-- Current open positions (§16).
create table wallet_positions (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references wallets(address) on delete cascade,
  token_mint text not null,
  token_symbol text,
  quantity numeric not null,
  current_price_usd numeric,
  current_price_reliability data_reliability not null default 'UNAVAILABLE',
  current_value_usd numeric,
  cost_basis_usd numeric,
  cost_basis_reliability data_reliability not null default 'UNAVAILABLE',
  average_entry_price numeric,
  average_entry_reliability data_reliability not null default 'UNAVAILABLE',
  unrealized_pnl_usd numeric,
  unrealized_roi_pct numeric,
  first_buy_at timestamptz,
  latest_buy_at timestamptz,
  num_buys integer not null default 0,
  num_partial_sells integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (wallet_address, token_mint)
);

-- Classified trade log (§17/§18). Idempotent on (wallet, signature) so webhook
-- retries never create duplicates (§46).
create table wallet_trades (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references wallets(address) on delete cascade,
  tx_signature text not null,
  instruction_index integer not null default 0,
  type transaction_type not null,
  token_mint text not null,
  token_symbol text,
  token_amount numeric not null,
  usd_value numeric,
  usd_value_reliability data_reliability not null default 'UNAVAILABLE',
  execution_price numeric,
  execution_price_reliability data_reliability not null default 'UNAVAILABLE',
  realized_pnl_usd numeric,
  realized_pnl_reliability data_reliability not null default 'UNAVAILABLE',
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (wallet_address, tx_signature, instruction_index)
);

create index wallet_trades_wallet_idx on wallet_trades (wallet_address, occurred_at desc);

create table tokens (
  mint text primary key,
  symbol text,
  name text,
  decimals integer,
  first_seen_at timestamptz not null default now()
);

create table token_market_data (
  id uuid primary key default gen_random_uuid(),
  token_mint text not null references tokens(mint) on delete cascade,
  price_usd numeric,
  liquidity_usd numeric,
  market_cap_usd numeric,
  volume_24h_usd numeric,
  fetched_at timestamptz not null default now()
);

create index token_market_data_mint_idx on token_market_data (token_mint, fetched_at desc);

-- Job run bookkeeping (§55).
create table job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  processed_items integer not null default 0,
  errors jsonb,
  duration_ms integer
);

create index job_runs_name_idx on job_runs (job_name, started_at desc);

-- Generic provider-response cache (§47) to minimize Birdeye/Helius usage.
create table api_cache (
  cache_key text primary key,
  provider text,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index api_cache_expires_idx on api_cache (expires_at);
