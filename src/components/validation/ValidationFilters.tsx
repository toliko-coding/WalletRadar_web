"use client";

import { useRouter, useSearchParams } from "next/navigation";

const MIN_WALLETS_OPTIONS = [2, 3, 4, 5];
const MIN_SCORE_OPTIONS = [0, 20, 40, 50, 60, 70];

/**
 * Queries convergence_events directly rather than any one persisted Demo
 * strategy's own criteria — lets a research question like "2+ wallets,
 * avg Smart Score >=60" be explored ad hoc, not limited to whatever a
 * strategy happens to have been configured with (plan §K).
 */
export function ValidationFilters({ minWallets, minAvgSmartScore }: { minWallets: number; minAvgSmartScore: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, String(value));
    router.replace(`/validation?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="text-xs">
        <div className="mb-1 text-muted">Minimum Wallets in Convergence</div>
        <select
          value={minWallets}
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
        <div className="mb-1 text-muted">Minimum Average Smart Score</div>
        <select
          value={minAvgSmartScore}
          onChange={(e) => update("minAvgSmartScore", Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
        >
          {MIN_SCORE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Any" : `≥${n}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
