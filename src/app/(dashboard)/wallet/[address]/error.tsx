"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function WalletDetailError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="Couldn't analyze this wallet" error={error} reset={reset} />;
}
