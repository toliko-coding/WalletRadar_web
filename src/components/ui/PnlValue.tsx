import { clsx } from "clsx";
import type { ReliableValue } from "@/types/domain";
import { ReliabilityTag } from "./ReliabilityTag";

function formatUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function PnlValue({ pnl }: { pnl: ReliableValue<number> }) {
  if (pnl.value === null) {
    return <span className="text-muted">Unavailable</span>;
  }
  return (
    <span
      className={clsx(
        "tabular-nums",
        pnl.value > 0 && "text-profit",
        pnl.value < 0 && "text-loss"
      )}
    >
      {formatUsd(pnl.value)}
      <ReliabilityTag reliability={pnl.reliability} />
    </span>
  );
}
