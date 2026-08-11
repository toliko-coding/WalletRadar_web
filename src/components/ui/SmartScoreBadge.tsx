import { clsx } from "clsx";

export function SmartScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const tone = score >= 80 ? "text-profit" : score >= 60 ? "text-warning" : "text-loss";
  const sizeClass =
    size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-xl";

  return (
    <div className="inline-flex items-baseline gap-1">
      <span className={clsx("font-semibold tabular-nums", sizeClass, tone)}>{score}</span>
      <span className="text-xs text-muted">/100</span>
    </div>
  );
}
