import { clsx } from "clsx";
import type { RiskLevel } from "@/types/domain";

const STYLES: Record<RiskLevel, string> = {
  LOW: "bg-profit/15 text-profit",
  MEDIUM: "bg-warning/15 text-warning",
  HIGH: "bg-loss/15 text-loss",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={clsx("rounded px-2 py-0.5 text-xs font-medium capitalize", STYLES[level])}>
      {level.toLowerCase()}
    </span>
  );
}
