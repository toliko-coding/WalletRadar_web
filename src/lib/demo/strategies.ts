import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { assertNoError } from "@/lib/supabase/assert";
import type {
  CreateStrategyInput,
  DemoAccount,
  DemoPortfolioSnapshot,
  DemoPosition,
  DemoStrategy,
  DemoTrade,
} from "./types";

function mapStrategy(row: Record<string, unknown>): DemoStrategy {
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as "ACTIVE" | "PAUSED",
    startingCapitalUsd: row.starting_capital_usd as number,
    minSmartScore: row.min_smart_score as number,
    minWalletsRequired: row.min_wallets_required as number,
    signalWindowMinutes: row.signal_window_minutes as number,
    virtualBuySizeUsd: row.virtual_buy_size_usd as number,
    maxOpenPositions: row.max_open_positions as number,
    maxAllocationPctPerToken: row.max_allocation_pct_per_token as number,
    stopLossPct: row.stop_loss_pct as number | null,
    takeProfitPct: row.take_profit_pct as number | null,
    maxPositionAgeHours: row.max_position_age_hours as number | null,
    simulatedSlippagePct: row.simulated_slippage_pct as number,
    feePct: row.fee_pct as number,
    minTokenLiquidityUsd: row.min_token_liquidity_usd as number | null,
    minMarketCapUsd: row.min_market_cap_usd as number | null,
    maxMarketCapUsd: row.max_market_cap_usd as number | null,
    createdAt: row.created_at as string,
  };
}

function mapPosition(row: Record<string, unknown>): DemoPosition {
  return {
    id: row.id as string,
    strategyId: row.strategy_id as string,
    signalId: row.signal_id as string,
    tokenMint: row.token_mint as string,
    tokenSymbol: row.token_symbol as string | null,
    status: row.status as "OPEN" | "CLOSED",
    entryPrice: row.entry_price as number,
    quantity: row.quantity as number,
    positionSizeUsd: row.position_size_usd as number,
    entryTime: row.entry_time as string,
    stopLossPrice: row.stop_loss_price as number | null,
    takeProfitPrice: row.take_profit_price as number | null,
    maxPositionAgeHours: row.max_position_age_hours as number | null,
    exitRule: row.exit_rule as string | null,
    exitTime: row.exit_time as string | null,
    exitPrice: row.exit_price as number | null,
    feesUsd: (row.fees_usd as number) ?? 0,
    grossPnlUsd: row.gross_pnl_usd as number | null,
    netPnlUsd: row.net_pnl_usd as number | null,
  };
}

function mapTrade(row: Record<string, unknown>): DemoTrade {
  return {
    id: row.id as string,
    strategyId: row.strategy_id as string,
    positionId: row.position_id as string,
    signalId: row.signal_id as string | null,
    action: row.action as "BUY" | "SELL",
    tokenMint: row.token_mint as string,
    tokenSymbol: row.token_symbol as string | null,
    referenceMarketPrice: row.reference_market_price as number,
    executionPrice: row.execution_price as number,
    simulatedSlippagePct: row.simulated_slippage_pct as number,
    quantity: row.quantity as number,
    usdValue: row.usd_value as number,
    feesUsd: (row.fees_usd as number) ?? 0,
    grossPnlUsd: row.gross_pnl_usd as number | null,
    netPnlUsd: row.net_pnl_usd as number | null,
    executedAt: row.executed_at as string,
  };
}

const DEFAULTS = {
  minSmartScore: 0,
  minWalletsRequired: 2,
  signalWindowMinutes: 180,
  virtualBuySizeUsd: 100,
  maxOpenPositions: 10,
  maxAllocationPctPerToken: 10,
  simulatedSlippagePct: 0.5,
  feePct: 0,
};

export async function createStrategy(input: CreateStrategyInput): Promise<DemoStrategy> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase is not configured — cannot create a Demo strategy without persistence.");

  const strategyResult = await supabase
    .from("demo_strategies")
    .insert({
      name: input.name,
      starting_capital_usd: input.startingCapitalUsd,
      min_smart_score: input.minSmartScore ?? DEFAULTS.minSmartScore,
      min_wallets_required: input.minWalletsRequired ?? DEFAULTS.minWalletsRequired,
      signal_window_minutes: input.signalWindowMinutes ?? DEFAULTS.signalWindowMinutes,
      virtual_buy_size_usd: input.virtualBuySizeUsd ?? DEFAULTS.virtualBuySizeUsd,
      max_open_positions: input.maxOpenPositions ?? DEFAULTS.maxOpenPositions,
      max_allocation_pct_per_token: input.maxAllocationPctPerToken ?? DEFAULTS.maxAllocationPctPerToken,
      stop_loss_pct: input.stopLossPct ?? null,
      take_profit_pct: input.takeProfitPct ?? null,
      max_position_age_hours: input.maxPositionAgeHours ?? null,
      simulated_slippage_pct: input.simulatedSlippagePct ?? DEFAULTS.simulatedSlippagePct,
      fee_pct: input.feePct ?? DEFAULTS.feePct,
      min_token_liquidity_usd: input.minTokenLiquidityUsd ?? null,
      min_market_cap_usd: input.minMarketCapUsd ?? null,
      max_market_cap_usd: input.maxMarketCapUsd ?? null,
    })
    .select()
    .single();
  assertNoError(strategyResult, "creating demo strategy");

  const strategy = mapStrategy(strategyResult.data as Record<string, unknown>);

  const accountResult = await supabase.from("demo_accounts").insert({
    strategy_id: strategy.id,
    cash_balance_usd: strategy.startingCapitalUsd,
  });
  assertNoError(accountResult, "creating demo account");

  return strategy;
}

export async function listStrategies(): Promise<DemoStrategy[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];
  const { data } = await supabase.from("demo_strategies").select("*").order("created_at", { ascending: true });
  return (data ?? []).map(mapStrategy);
}

export async function getStrategy(id: string): Promise<DemoStrategy | null> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;
  const { data } = await supabase.from("demo_strategies").select("*").eq("id", id).maybeSingle();
  return data ? mapStrategy(data) : null;
}

export async function getAccount(strategyId: string): Promise<DemoAccount | null> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("demo_accounts")
    .select("strategy_id, cash_balance_usd")
    .eq("strategy_id", strategyId)
    .maybeSingle();
  return data ? { strategyId: data.strategy_id as string, cashBalanceUsd: data.cash_balance_usd as number } : null;
}

export async function setStrategyStatus(id: string, status: "ACTIVE" | "PAUSED"): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;
  const result = await supabase
    .from("demo_strategies")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  assertNoError(result, "updating demo strategy status");
}

/** Clears all activity and restarts the same strategy config with fresh capital (§27). Never deletes the strategy config itself. */
export async function resetStrategy(id: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return;
  const strategy = await getStrategy(id);
  if (!strategy) throw new Error(`Demo strategy ${id} not found`);

  for (const table of ["demo_trades", "demo_positions", "demo_signals", "demo_portfolio_snapshots"] as const) {
    const result = await supabase.from(table).delete().eq("strategy_id", id);
    assertNoError(result, `clearing ${table} for reset`);
  }

  const accountResult = await supabase
    .from("demo_accounts")
    .update({ cash_balance_usd: strategy.startingCapitalUsd, updated_at: new Date().toISOString() })
    .eq("strategy_id", id);
  assertNoError(accountResult, "resetting demo account balance");
}

export async function getOpenPositions(strategyId: string): Promise<DemoPosition[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("demo_positions")
    .select("*")
    .eq("strategy_id", strategyId)
    .eq("status", "OPEN")
    .order("entry_time", { ascending: false });
  return (data ?? []).map(mapPosition);
}

export async function getClosedPositions(strategyId: string, limit = 50): Promise<DemoPosition[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("demo_positions")
    .select("*")
    .eq("strategy_id", strategyId)
    .eq("status", "CLOSED")
    .order("exit_time", { ascending: false })
    .limit(limit);
  return (data ?? []).map(mapPosition);
}

export async function getTrades(strategyId: string, limit = 50): Promise<DemoTrade[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("demo_trades")
    .select("*")
    .eq("strategy_id", strategyId)
    .order("executed_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(mapTrade);
}

export async function getSnapshots(strategyId: string, limit = 500): Promise<DemoPortfolioSnapshot[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("demo_portfolio_snapshots")
    .select("*")
    .eq("strategy_id", strategyId)
    .order("snapshot_at", { ascending: true })
    .limit(limit);
  return (data ?? []).map((row) => ({
    snapshotAt: row.snapshot_at as string,
    cashBalanceUsd: row.cash_balance_usd as number,
    openPositionValueUsd: row.open_position_value_usd as number,
    totalValueUsd: row.total_value_usd as number,
    realizedPnlUsd: row.realized_pnl_usd as number,
    unrealizedPnlUsd: row.unrealized_pnl_usd as number,
    totalPnlUsd: row.total_pnl_usd as number,
    roiPct: row.roi_pct as number,
  }));
}
