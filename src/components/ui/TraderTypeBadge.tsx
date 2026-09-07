import { clsx } from "clsx";
import type { TraderType } from "@/types/domain";

const LABELS: Record<TraderType, string> = {
  SMART_TRADER: "Smart Trader",
  MANUAL_UNKNOWN: "Manual / Unknown",
  BOT_SUSPECTED: "Bot Suspected",
  SNIPER: "Sniper",
  INSIDER_TAGGED: "Insider Tagged",
  DEVELOPER: "Developer",
  BUNDLER: "Bundler",
};

const STYLES: Record<TraderType, string> = {
  SMART_TRADER: "bg-profit/15 text-profit",
  MANUAL_UNKNOWN: "bg-surface-raised text-muted",
  BOT_SUSPECTED: "bg-warning/15 text-warning",
  SNIPER: "bg-warning/15 text-warning",
  INSIDER_TAGGED: "bg-loss/15 text-loss",
  DEVELOPER: "bg-loss/15 text-loss",
  BUNDLER: "bg-loss/15 text-loss",
};

/** MANUAL_UNKNOWN is the "nothing to report" default — hidden rather than shown as a badge everywhere. */
export function TraderTypeBadge({ type }: { type: TraderType }) {
  if (type === "MANUAL_UNKNOWN") return null;
  return (
    <span className={clsx("rounded px-2 py-0.5 text-xs font-medium", STYLES[type])} title={
      type === "BOT_SUSPECTED"
        ? `Trade frequency exceeds what a human plausibly could sustain (§6) — a heuristic label, not certain`
        : undefined
    }>
      {LABELS[type]}
    </span>
  );
}
