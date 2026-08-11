import { clsx } from "clsx";
import type { TransactionType } from "@/types/domain";

const LABELS: Record<TransactionType, string> = {
  DEX_SWAP_BUY: "BUY",
  DEX_SWAP_SELL: "SELL",
  TRANSFER_IN: "TRANSFER IN",
  TRANSFER_OUT: "TRANSFER OUT",
  AIRDROP: "AIRDROP",
  STAKE: "STAKE",
  LP_ACTION: "LP ACTION",
  UNKNOWN: "UNKNOWN",
};

const STYLES: Record<TransactionType, string> = {
  DEX_SWAP_BUY: "bg-profit/15 text-profit",
  DEX_SWAP_SELL: "bg-loss/15 text-loss",
  TRANSFER_IN: "bg-accent/15 text-accent",
  TRANSFER_OUT: "bg-accent/15 text-accent",
  AIRDROP: "bg-surface-raised text-muted",
  STAKE: "bg-surface-raised text-muted",
  LP_ACTION: "bg-surface-raised text-muted",
  UNKNOWN: "bg-surface-raised text-muted",
};

export function TransactionTypeBadge({ type }: { type: TransactionType }) {
  return (
    <span className={clsx("rounded px-2 py-0.5 text-[11px] font-medium", STYLES[type])}>
      {LABELS[type]}
    </span>
  );
}
