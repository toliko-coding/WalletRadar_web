"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function RefreshAnalysisButton({ walletAddress, analyzedAt }: { walletAddress: string; analyzedAt: string }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/wallet/${walletAddress}/analyze?window=90D`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span>Analyzed {formatAge(analyzedAt)} (cached — no live API call on page view)</span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        className="rounded border border-border px-2 py-1 text-foreground hover:bg-surface-raised disabled:opacity-50"
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      {error ? <span className="text-loss">{error}</span> : null}
    </div>
  );
}
