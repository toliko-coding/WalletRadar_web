export default function WalletDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="h-16 animate-pulse rounded-lg border border-border bg-surface" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-surface" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg border border-border bg-surface" />
    </div>
  );
}
