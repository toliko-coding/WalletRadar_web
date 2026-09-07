"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DemoPortfolioSnapshot } from "@/lib/demo/types";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Built from persisted demo_portfolio_snapshots (§36) — never reconstructed
 * from current positions alone, so the curve reflects what the portfolio
 * was actually worth at each past tick, not a backward-looking guess.
 */
export function EquityCurveChart({ snapshots }: { snapshots: DemoPortfolioSnapshot[] }) {
  if (snapshots.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">
        Not enough snapshots yet — each &quot;Evaluate Signals Now&quot; run adds one. The
        equity curve fills in as the strategy ticks forward over time.
      </div>
    );
  }

  const data = snapshots.map((s) => ({
    time: formatDateTime(s.snapshotAt),
    value: Number(s.totalValueUsd.toFixed(2)),
  }));

  return (
    <div className="h-48 rounded-lg border border-border bg-surface p-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={56} />
          <Tooltip
            contentStyle={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--muted)" }}
            formatter={(value) => [`$${Number(value).toLocaleString()}`, "Portfolio Value"]}
          />
          <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
