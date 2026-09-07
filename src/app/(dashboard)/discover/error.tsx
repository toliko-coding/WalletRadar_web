"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function DiscoverError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="Couldn't load Discover" error={error} reset={reset} />;
}
