"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function SmartMoneyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="Couldn't load Smart Money activity" error={error} reset={reset} />;
}
