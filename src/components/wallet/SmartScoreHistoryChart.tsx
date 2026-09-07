"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ScoreHistoryPoint } from "@/lib/analysis/score-history";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SmartScoreHistoryChart({ points }: { points: ScoreHistoryPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">
        Not enough history yet — Smart Score is tracked on every analysis run, so this fills
        in as this wallet gets re-analyzed over time.
      </div>
    );
  }

  const data = points.map((p) => ({ date: formatDate(p.snapshotAt), score: p.smartScore }));

  return (
    <div className="h-40 rounded-lg border border-border bg-surface p-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--muted)" }}
          />
          <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
