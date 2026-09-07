"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function DemoError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="Couldn't load Demo trading" error={error} reset={reset} />;
}
