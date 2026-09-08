"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function CreateStrategyForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Recommended Smart Money");
  const [startingCapitalUsd, setStartingCapitalUsd] = useState(10_000);
  const [minSmartScore, setMinSmartScore] = useState(50);
  const [minWalletsRequired, setMinWalletsRequired] = useState(2);
  const [signalWindowMinutes, setSignalWindowMinutes] = useState(180);
  const [virtualBuySizeUsd, setVirtualBuySizeUsd] = useState(100);
  const [maxOpenPositions, setMaxOpenPositions] = useState(10);
  const [stopLossPct, setStopLossPct] = useState<number | "">(10);
  const [takeProfitPct, setTakeProfitPct] = useState<number | "">(20);
  const [maxPositionAgeHours, setMaxPositionAgeHours] = useState<number | "">(72);
  const [simulatedSlippagePct, setSimulatedSlippagePct] = useState(0.5);
  const [minTokenLiquidityUsd, setMinTokenLiquidityUsd] = useState<number | "">("");
  const [minMarketCapUsd, setMinMarketCapUsd] = useState<number | "">("");
  const [maxMarketCapUsd, setMaxMarketCapUsd] = useState<number | "">("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          startingCapitalUsd,
          minSmartScore,
          minWalletsRequired,
          signalWindowMinutes,
          virtualBuySizeUsd,
          maxOpenPositions,
          stopLossPct: stopLossPct === "" ? null : stopLossPct,
          takeProfitPct: takeProfitPct === "" ? null : takeProfitPct,
          maxPositionAgeHours: maxPositionAgeHours === "" ? null : maxPositionAgeHours,
          simulatedSlippagePct,
          minTokenLiquidityUsd: minTokenLiquidityUsd === "" ? null : minTokenLiquidityUsd,
          minMarketCapUsd: minMarketCapUsd === "" ? null : minMarketCapUsd,
          maxMarketCapUsd: maxMarketCapUsd === "" ? null : maxMarketCapUsd,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      if (json.id) {
        router.push(`/demo?strategy=${json.id}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create strategy");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="text-sm font-medium text-foreground">New Demo Strategy</div>
      <p className="mt-1 text-xs text-muted">
        Fully virtual — no real funds, no on-chain transactions. Entry price is always the
        market price at detection time, never a source wallet&apos;s historical price (§30).
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-xs">
          <div className="mb-1 text-muted">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Starting Capital ($)</div>
          <input
            type="number"
            value={startingCapitalUsd}
            onChange={(e) => setStartingCapitalUsd(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Virtual Buy Size ($)</div>
          <input
            type="number"
            value={virtualBuySizeUsd}
            onChange={(e) => setVirtualBuySizeUsd(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Minimum Smart Score</div>
          <input
            type="number"
            value={minSmartScore}
            onChange={(e) => setMinSmartScore(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Minimum Smart Wallets</div>
          <input
            type="number"
            value={minWalletsRequired}
            onChange={(e) => setMinWalletsRequired(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Signal Window (minutes)</div>
          <input
            type="number"
            value={signalWindowMinutes}
            onChange={(e) => setSignalWindowMinutes(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Max Open Positions</div>
          <input
            type="number"
            value={maxOpenPositions}
            onChange={(e) => setMaxOpenPositions(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Stop Loss (%, optional)</div>
          <input
            type="number"
            value={stopLossPct}
            onChange={(e) => setStopLossPct(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Take Profit (%, optional)</div>
          <input
            type="number"
            value={takeProfitPct}
            onChange={(e) => setTakeProfitPct(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Max Holding Period (hours, optional)</div>
          <input
            type="number"
            value={maxPositionAgeHours}
            onChange={(e) => setMaxPositionAgeHours(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs">
          <div className="mb-1 text-muted">Simulated Slippage (%)</div>
          <input
            type="number"
            step="0.1"
            value={simulatedSlippagePct}
            onChange={(e) => setSimulatedSlippagePct(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <div className="text-xs font-medium text-foreground">Token Risk Filters (§43, optional)</div>
        <p className="mt-1 text-xs text-muted">
          Skip a signal entirely rather than paper-buy it when the token&apos;s liquidity/market
          cap can&apos;t be verified against these — never assumed fine when unknown.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs">
            <div className="mb-1 text-muted">Min Liquidity ($, optional)</div>
            <input
              type="number"
              value={minTokenLiquidityUsd}
              onChange={(e) => setMinTokenLiquidityUsd(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="No minimum"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="text-xs">
            <div className="mb-1 text-muted">Min Market Cap ($, optional)</div>
            <input
              type="number"
              value={minMarketCapUsd}
              onChange={(e) => setMinMarketCapUsd(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="No minimum"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="text-xs">
            <div className="mb-1 text-muted">Max Market Cap ($, optional)</div>
            <input
              type="number"
              value={maxMarketCapUsd}
              onChange={(e) => setMaxMarketCapUsd(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="No maximum"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create Strategy"}
      </button>
      {error ? <div className="mt-2 text-xs text-loss">{error}</div> : null}
    </form>
  );
}
