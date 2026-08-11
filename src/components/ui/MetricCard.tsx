import type { ReactNode } from "react";
import { clsx } from "clsx";

export function MetricCard({
  label,
  value,
  sublabel,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: "neutral" | "profit" | "loss";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={clsx(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          tone === "neutral" && "text-foreground"
        )}
      >
        {value}
      </div>
      {sublabel ? <div className="mt-0.5 text-xs text-muted">{sublabel}</div> : null}
    </div>
  );
}
