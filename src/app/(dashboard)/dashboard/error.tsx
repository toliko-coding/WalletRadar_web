"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="Couldn't load the leaderboard" error={error} reset={reset} />;
}
