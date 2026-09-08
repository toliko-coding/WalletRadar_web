"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DemoStrategy } from "@/lib/demo/types";

export function DemoActions({ strategy }: { strategy: DemoStrategy }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: string, path: string, method: "POST" | "DELETE" = "POST") {
    setPending(action);
    setMessage(null);
    try {
      const res = await fetch(path, { method });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      if (action === "tick") {
        const skipped: Array<{ tokenMint: string; tokenSymbol: string | null; reason: string }> =
          json.skippedSignals ?? [];
        const skippedSummary = skipped.length
          ? ` — skipped: ${skipped.map((s) => `${s.tokenSymbol ?? s.tokenMint.slice(0, 4)} (${s.reason})`).join(", ")}`
          : "";
        setMessage(
          `Signals considered: ${json.signalsConsidered}, opened: ${json.positionsOpened}, closed: ${json.positionsClosed}, price calls: ${json.priceCallsMade}${skippedSummary}${json.errors?.length ? `, errors: ${json.errors.join("; ")}` : ""}`
        );
      }
      if (action === "delete") {
        router.push("/demo");
      }
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => run("tick", `/api/demo/strategies/${strategy.id}/tick`)}
        disabled={pending !== null || strategy.status !== "ACTIVE"}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
      >
        {pending === "tick" ? "Running…" : "Evaluate Signals Now"}
      </button>
      {strategy.status === "ACTIVE" ? (
        <button
          type="button"
          onClick={() => run("pause", `/api/demo/strategies/${strategy.id}/pause`)}
          disabled={pending !== null}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-raised disabled:opacity-50"
        >
          Pause
        </button>
      ) : (
        <button
          type="button"
          onClick={() => run("resume", `/api/demo/strategies/${strategy.id}/resume`)}
          disabled={pending !== null}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-raised disabled:opacity-50"
        >
          Resume
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (confirm(`Reset "${strategy.name}"? This clears all positions/trades/history and restarts at $${strategy.startingCapitalUsd.toLocaleString()}.`)) {
            run("reset", `/api/demo/strategies/${strategy.id}/reset`);
          }
        }}
        disabled={pending !== null}
        className="rounded-md border border-loss/30 px-3 py-1.5 text-xs text-loss hover:bg-loss/10 disabled:opacity-50"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm(`Permanently delete "${strategy.name}"? This removes the strategy and all its history — unlike Reset, this cannot be undone.`)) {
            run("delete", `/api/demo/strategies/${strategy.id}`, "DELETE");
          }
        }}
        disabled={pending !== null}
        className="rounded-md border border-loss/30 px-3 py-1.5 text-xs text-loss hover:bg-loss/10 disabled:opacity-50"
      >
        Delete
      </button>
      {message ? <span className="text-xs text-muted">{message}</span> : null}
    </div>
  );
}
