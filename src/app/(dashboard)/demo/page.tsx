import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { CreateStrategyForm } from "@/components/demo/CreateStrategyForm";
import { DemoActions } from "@/components/demo/DemoActions";
import { DemoOverview } from "@/components/demo/DemoOverview";
import { EquityCurveChart } from "@/components/demo/EquityCurveChart";
import { DemoPositionsTable } from "@/components/demo/DemoPositionsTable";
import { DemoTradesFeed } from "@/components/demo/DemoTradesFeed";
import { StrategyComparisonTable } from "@/components/demo/StrategyComparisonTable";
import { getStrategyComparison } from "@/lib/demo/comparison";
import {
  listStrategies,
  getAccount,
  getOpenPositions,
  getClosedPositions,
  getTrades,
  getSnapshots,
} from "@/lib/demo/strategies";
import { getBenchmarkComparison } from "@/lib/demo/benchmarks";
import { calculatePortfolioValuation } from "@/lib/demo/engine";
import { isSupabaseConfigured } from "@/lib/env";

// Positions/trades/snapshots change on every tick — must stay dynamic.
export const dynamic = "force-dynamic";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div>
        <PageHeader title="Demo / Paper Trading" description="Fully virtual — no real funds or on-chain transactions are ever involved." />
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Supabase isn&apos;t configured, so Demo strategies can&apos;t be persisted. See /settings.
        </div>
      </div>
    );
  }

  const strategies = await listStrategies();

  if (strategies.length === 0) {
    return (
      <div>
        <PageHeader title="Demo / Paper Trading" description="Fully virtual — no real funds or on-chain transactions are ever involved." />
        <CreateStrategyForm />
      </div>
    );
  }

  const params = await searchParams;
  const requestedId = Array.isArray(params.strategy) ? params.strategy[0] : params.strategy;
  const strategy = strategies.find((s) => s.id === requestedId) ?? strategies[0];

  const [account, openPositions, closedPositions, trades, snapshots] = await Promise.all([
    getAccount(strategy.id),
    getOpenPositions(strategy.id),
    getClosedPositions(strategy.id, 200),
    getTrades(strategy.id, 30),
    getSnapshots(strategy.id),
  ]);

  if (!account) {
    return (
      <div>
        <PageHeader title="Demo / Paper Trading" />
        <div className="rounded-lg border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          Strategy &quot;{strategy.name}&quot; has no demo_accounts row — this shouldn&apos;t
          happen (createStrategy always creates both together). Try Reset, or check Supabase
          directly.
        </div>
      </div>
    );
  }

  const latestSnapshot = snapshots[snapshots.length - 1];
  // Fall back to a zero-position valuation (no live prices fetched here —
  // that only happens on a tick) so the page still renders something
  // sensible before the first "Evaluate Signals Now" run.
  const valuation =
    latestSnapshot ??
    calculatePortfolioValuation(account.cashBalanceUsd, strategy.startingCapitalUsd, [], closedPositions.map((p) => ({ netPnlUsd: p.netPnlUsd ?? 0 })));

  const totalValueUsd = valuation.totalValueUsd;
  const benchmark = await getBenchmarkComparison(strategy.id, strategy.createdAt, valuation.roiPct);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demo / Paper Trading"
        description="Fully virtual — no real funds or on-chain transactions are ever involved."
        actions={<DemoActions strategy={strategy} />}
      />

      {strategies.length > 1 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {strategies.map((s) => (
              <Link
                key={s.id}
                href={`/demo?strategy=${s.id}`}
                className={`rounded-full border px-3 py-1 ${s.id === strategy.id ? "border-accent text-accent" : "border-border text-muted hover:text-foreground"}`}
              >
                {s.name} {s.status === "PAUSED" ? "(paused)" : ""}
              </Link>
            ))}
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-foreground">Compare Strategies</div>
            <StrategyComparisonTable rows={await getStrategyComparison()} />
          </div>
        </div>
      ) : null}

      <DemoOverview
        strategy={strategy}
        account={account}
        totalValueUsd={totalValueUsd}
        openPositionValueUsd={valuation.openPositionValueUsd}
        realizedPnlUsd={valuation.realizedPnlUsd}
        unrealizedPnlUsd={valuation.unrealizedPnlUsd}
        totalPnlUsd={valuation.totalPnlUsd}
        roiPct={valuation.roiPct}
        benchmark={benchmark}
      />

      <div>
        <div className="mb-2 text-sm font-medium text-foreground">Equity Curve</div>
        <EquityCurveChart snapshots={snapshots} />
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-foreground">
          Open Positions <span className="font-normal text-muted">({openPositions.length}/{strategy.maxOpenPositions})</span>
        </div>
        <DemoPositionsTable positions={openPositions} />
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-foreground">Recent Demo Trades</div>
        <DemoTradesFeed trades={trades} />
      </div>
    </div>
  );
}
