"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function WalletAnalyzerForm() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = address.trim();
    if (!SOLANA_ADDRESS_RE.test(trimmed)) {
      setError("Enter a valid Solana wallet address (base58, 32–44 characters).");
      return;
    }
    setError(null);
    router.push(`/wallet/${trimmed}`);
  }

  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="text-sm font-medium text-foreground">Manual Wallet Analyzer</div>
      <p className="mt-1 text-xs text-muted">
        Discovery is automated in later phases — for now, analyze any Solana wallet
        directly against live Birdeye/Helius data to validate the pipeline.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter a Solana wallet address…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Analyze
        </button>
      </form>
      {error ? <div className="mt-2 text-xs text-loss">{error}</div> : null}
    </div>
  );
}
