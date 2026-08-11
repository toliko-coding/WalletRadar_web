"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PRESETS, type BuiltinPresetId, type FilterCriteria } from "@/lib/discovery/presets";

const LIMIT_OPTIONS = [10, 25, 50, 100];
const WINDOW_OPTIONS = ["7D", "30D", "90D", "180D", "1Y", "ALL"];
const RISK_OPTIONS = ["ALL", "LOW", "MEDIUM", "HIGH"] as const;
const TRADER_TYPE_OPTIONS = ["ALL", "SMART_TRADER", "MANUAL_UNKNOWN", "BOT_SUSPECTED", "SNIPER"] as const;

function labelFor(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FiltersBar({
  presetId,
  isCustom,
  criteria,
  windowLabel,
}: {
  presetId: BuiltinPresetId | "custom";
  isCustom: boolean;
  criteria: FilterCriteria;
  windowLabel: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const currentPresetLabel = isCustom ? "Custom" : PRESETS[presetId as BuiltinPresetId].label;

  function updateParams(updates: Record<string, string | number | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "") params.delete(key);
      else params.set(key, String(value));
    }
    router.replace(`/dashboard?${params.toString()}`);
  }

  function applyPreset(id: string) {
    // Switching preset clears any prior field-level overrides so the new
    // preset's own numbers actually take effect instead of being masked.
    const params = new URLSearchParams();
    params.set("preset", id);
    if (windowLabel !== "90D") params.set("window", windowLabel);
    router.replace(`/dashboard?${params.toString()}`);
  }

  function applyField(key: keyof FilterCriteria, value: string | number) {
    updateParams({ preset: "custom", [key]: value });
  }

  const advancedFields = useMemo(
    () => [
      { key: "minTrades" as const, label: "Minimum Trades" },
      { key: "minVolumeUsd" as const, label: "Minimum Volume ($)" },
      { key: "minWinRatePct" as const, label: "Minimum Win Rate (%)" },
      { key: "maxDrawdownPct" as const, label: "Maximum Drawdown (%)" },
      { key: "minTradingHistoryDays" as const, label: "Minimum Trading History (days, approx.)" },
      { key: "recentActivityDays" as const, label: "Must Have Traded Within (days)" },
      { key: "minRoiPct" as const, label: "Minimum ROI (%)" },
      { key: "minPnlUsd" as const, label: "Minimum Realized PnL ($)" },
      { key: "minAvgTradeSizeUsd" as const, label: "Minimum Avg Trade Size ($)" },
    ],
    []
  );

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <div className="mb-1 text-muted">Preset</div>
          <select
            value={isCustom ? "custom" : presetId}
            onChange={(e) => applyPreset(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
          >
            {Object.values(PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>

        <label className="text-xs">
          <div className="mb-1 text-muted">Show</div>
          <select
            value={criteria.limit}
            onChange={(e) => applyField("limit", Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <div className="mb-1 text-muted">Performance</div>
          <select
            value={windowLabel}
            onChange={(e) => updateParams({ window: e.target.value })}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
          >
            {WINDOW_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <div className="mb-1 text-muted">Risk Level</div>
          <select
            value={criteria.riskLevel}
            onChange={(e) => applyField("riskLevel", e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
          >
            {RISK_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {labelFor(r)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <div className="mb-1 text-muted">Trader Type</div>
          <select
            value={criteria.traderType}
            onChange={(e) => applyField("traderType", e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
          >
            {TRADER_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {labelFor(t)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-raised"
        >
          {advancedOpen ? "Hide Filters" : "Filters"}
        </button>

        <span className="ml-auto text-xs text-muted">
          Active preset: <span className="text-foreground">{currentPresetLabel}</span>
        </span>
      </div>

      {windowLabel !== "90D" ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Only the 90D window has been analyzed so far — batch analysis always scores wallets
          at 90D today. Other windows will show no results until multi-window analysis exists.
        </div>
      ) : null}

      {advancedOpen ? (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
          {advancedFields.map((field) => (
            <label key={field.key} className="text-xs">
              <div className="mb-1 text-muted">{field.label}</div>
              <input
                type="number"
                defaultValue={criteria[field.key] as number}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value) && value !== criteria[field.key]) {
                    applyField(field.key, value);
                  }
                }}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
