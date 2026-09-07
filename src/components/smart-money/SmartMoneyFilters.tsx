"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { SmartMoneyCriteria } from "@/lib/smart-money/data";

const MIN_WALLETS_OPTIONS = [2, 3, 4, 5];
const WINDOW_OPTIONS = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "3 hours", minutes: 180 },
  { label: "6 hours", minutes: 360 },
  { label: "24 hours", minutes: 1440 },
];

export function SmartMoneyFilters({ criteria }: { criteria: SmartMoneyCriteria }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string | number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, String(value));
    router.replace(`/smart-money?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="text-xs">
        <div className="mb-1 text-muted">Minimum Smart Wallets</div>
        <select
          value={criteria.minWallets}
          onChange={(e) => update("minWallets", Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        >
          {MIN_WALLETS_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
              {n === 5 ? "+" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs">
        <div className="mb-1 text-muted">Time Window</div>
        <select
          value={criteria.windowMinutes}
          onChange={(e) => update("windowMinutes", Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        >
          {WINDOW_OPTIONS.map((w) => (
            <option key={w.minutes} value={w.minutes}>
              {w.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs">
        <div className="mb-1 text-muted">Minimum Smart Score</div>
        <input
          type="number"
          defaultValue={criteria.minSmartScore}
          onBlur={(e) => update("minSmartScore", Number(e.target.value) || 0)}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        />
      </label>

      <label className="text-xs">
        <div className="mb-1 text-muted">Minimum Combined Buy ($)</div>
        <input
          type="number"
          defaultValue={criteria.minCombinedUsd ?? ""}
          placeholder="Any"
          onBlur={(e) => update("minCombinedUsd", e.target.value === "" ? 0 : Number(e.target.value))}
          className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        />
      </label>

      <label className="text-xs">
        <div className="mb-1 text-muted">Lookback</div>
        <select
          value={criteria.lookbackHours}
          onChange={(e) => update("lookbackHours", Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        >
          <option value={24}>24 hours</option>
          <option value={72}>3 days</option>
          <option value={168}>7 days</option>
          <option value={720}>30 days</option>
        </select>
      </label>
    </div>
  );
}
