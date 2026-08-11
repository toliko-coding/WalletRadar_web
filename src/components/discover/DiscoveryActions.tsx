"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface JobResultSummary {
  label: string;
  detail: string;
  errors: string[];
}

async function runJob(path: string, body?: unknown): Promise<JobResultSummary> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    return { label: path, detail: json.error ?? `Request failed (${res.status})`, errors: [] };
  }
  return { label: path, detail: JSON.stringify(json), errors: json.errors ?? [] };
}

export function DiscoveryActions() {
  const router = useRouter();
  const [pending, setPending] = useState<"discover" | "analyze" | null>(null);
  const [result, setResult] = useState<JobResultSummary | null>(null);

  async function handleDiscover() {
    setPending("discover");
    setResult(null);
    const summary = await runJob("/api/jobs/discover-wallets");
    setResult(summary);
    setPending(null);
    router.refresh();
  }

  async function handleAnalyze() {
    setPending("analyze");
    setResult(null);
    const summary = await runJob("/api/jobs/analyze-candidates", { limit: 10 });
    setResult(summary);
    setPending(null);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="text-sm font-medium text-foreground">Discovery Pipeline</div>
      <p className="mt-1 text-xs text-muted">
        No scheduler is wired up yet (needs a public URL — see supabase/CRON.md), so trigger
        each stage manually: discovery finds candidate wallets from trending tokens&apos; top
        traders, analysis scores up to 10 pending candidates per run against live Birdeye/Helius
        data.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDiscover}
          disabled={pending !== null}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending === "discover" ? "Running…" : "Run Discovery Scan"}
        </button>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={pending !== null}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-raised disabled:opacity-50"
        >
          {pending === "analyze" ? "Running…" : "Analyze Pending Candidates"}
        </button>
      </div>
      {result ? (
        <div className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-xs">
          <div className="text-muted">{result.detail}</div>
          {result.errors.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-loss">
              {result.errors.slice(0, 5).map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
