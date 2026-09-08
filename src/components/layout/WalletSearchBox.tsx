"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isValidSolanaAddress } from "@/lib/solana/address";

export function WalletSearchBox() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = address.trim();
    if (!isValidSolanaAddress(trimmed)) {
      setError(true);
      return;
    }
    setError(false);
    setAddress("");
    router.push(`/wallet/${trimmed}`);
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <input
        value={address}
        onChange={(e) => {
          setAddress(e.target.value);
          if (error) setError(false);
        }}
        placeholder="Jump to wallet address…"
        aria-label="Jump to wallet address"
        className={`w-40 rounded-md border bg-surface-raised px-2.5 py-1.5 text-xs font-mono text-foreground placeholder:font-sans placeholder:text-muted focus:outline-none sm:w-56 ${
          error ? "border-loss" : "border-border focus:border-accent"
        }`}
      />
      {error ? (
        <div className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-loss/30 bg-surface px-2 py-1 text-[11px] text-loss shadow-sm">
          Not a valid Solana address
        </div>
      ) : null}
    </form>
  );
}
