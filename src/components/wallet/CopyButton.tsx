"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
