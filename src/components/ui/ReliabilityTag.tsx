import { clsx } from "clsx";
import type { DataReliability } from "@/types/domain";

const LABELS: Record<DataReliability, string> = {
  EXACT: "exact",
  ON_CHAIN: "on-chain",
  PROVIDER_CALCULATED: "provider",
  CALCULATED: "calculated",
  ESTIMATED: "est.",
  UNAVAILABLE: "n/a",
};

/** Never let an estimate read as a fact (§50) — every non-exact figure carries this tag. */
export function ReliabilityTag({ reliability }: { reliability: DataReliability }) {
  if (reliability === "EXACT" || reliability === "ON_CHAIN") return null;
  return (
    <span
      className={clsx(
        "ml-1.5 rounded px-1 py-0.5 text-[10px] uppercase tracking-wide",
        reliability === "UNAVAILABLE"
          ? "bg-warning/15 text-warning"
          : "bg-surface-raised text-muted"
      )}
      title={
        reliability === "UNAVAILABLE"
          ? "Not available from any data source — never fabricated"
          : `Reliability: ${reliability}`
      }
    >
      {LABELS[reliability]}
    </span>
  );
}
