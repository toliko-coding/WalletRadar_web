"use client";

import { useState } from "react";
import { CreateStrategyForm } from "@/components/demo/CreateStrategyForm";

/**
 * CreateStrategyForm only ever rendered in the empty-state (0 strategies) —
 * once a strategy exists there was no way through the UI to add another,
 * even though multi-strategy comparison (StrategyComparisonTable) is fully
 * built and expects more than one. This is the missing entry point.
 */
export function NewStrategyPanel() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-raised"
      >
        + New Strategy
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-muted hover:text-foreground"
      >
        ← Cancel
      </button>
      <CreateStrategyForm />
    </div>
  );
}
