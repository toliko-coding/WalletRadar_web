"use client";

export default function WalletDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-loss/30 bg-loss/10 px-5 py-4">
      <div className="text-sm font-medium text-loss">Couldn&apos;t analyze this wallet</div>
      <div className="mt-1 text-sm text-muted">{error.message}</div>
      <button
        type="button"
        onClick={reset}
        className="mt-3 rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-raised"
      >
        Try again
      </button>
    </div>
  );
}
