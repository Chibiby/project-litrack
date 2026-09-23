"use client";

import * as React from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  DEFAULT_REPORT_PURPOSE,
  type ReportPurpose,
} from "@/lib/reports/report-frame";

/** Re-exported under the export-panel name every caller already uses; same values as `ReportPurpose`. */
export type ExportPurpose = ReportPurpose;

const STORAGE_KEY = "litrack.exportPurpose";

const OPTIONS: { value: ExportPurpose; label: string; hint: string }[] = [
  {
    value: "PRINT",
    label: "For printing",
    hint: "Official DepEd layout with the seal, headings and signature lines, set up for A4.",
  },
  {
    value: "RECORDS",
    label: "For records",
    hint: "A plain table for sorting, filtering or importing. No logos or merged cells.",
  },
];

/** Reads the remembered choice. Wrapped in try/catch: private-mode Safari and a full quota both throw on read, not just write. */
export function readStoredExportPurpose(): ExportPurpose {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "RECORDS"
      ? "RECORDS"
      : DEFAULT_REPORT_PURPOSE;
  } catch {
    return DEFAULT_REPORT_PURPOSE;
  }
}

function writeStoredExportPurpose(value: ExportPurpose): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // No persistence this session — the toggle still works for the current visit.
  }
}

// A same-tab `localStorage` write fires no `storage` event (that only reaches
// OTHER tabs), so `useSyncExternalStore` needs its own subscribe/notify pair
// to see a change made by this hook's own `setPurpose`.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function getServerSnapshot(): ExportPurpose {
  return DEFAULT_REPORT_PURPOSE;
}

/**
 * The remembered export layout choice, as a piece of component state.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: an effect that
 * calls `setState` to sync from `localStorage` after mount trips the
 * `react-hooks/set-state-in-effect` rule and, more to the point, is exactly
 * the "read an external store" case that hook exists for — the server
 * snapshot (`PRINT`) and the client's first paint both come from it, so
 * there is no synchronous read of `window` during render to desync.
 */
export function useExportPurpose(): [ExportPurpose, (value: ExportPurpose) => void] {
  const purpose = React.useSyncExternalStore(
    subscribe,
    readStoredExportPurpose,
    getServerSnapshot
  );

  const setPurpose = React.useCallback((value: ExportPurpose) => {
    writeStoredExportPurpose(value);
    notify();
  }, []);

  return [purpose, setPurpose];
}

type Props = {
  value: ExportPurpose;
  onChange: (value: ExportPurpose) => void;
  /** PDF is always the print layout — pass true rather than hiding the field, so the row never reflows. */
  disabled?: boolean;
  className?: string;
  /** Omit the built-in "Layout" caption when a caller (e.g. reports-hub's `Field`) already labels the control. */
  hideLabel?: boolean;
};

/**
 * The two-option "For printing" / "For records" choice every Excel/PDF
 * export surfaces before it runs. Compact by design: it sits beside the
 * existing format/Download controls on every export panel, so it may not
 * add a row of its own.
 */
export function ExportPurposeToggle({
  value,
  onChange,
  disabled,
  className,
  hideLabel,
}: Props) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {!hideLabel && (
        <span
          id="export-purpose-label"
          className="text-xs font-medium text-muted-foreground"
        >
          Layout
        </span>
      )}
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as ExportPurpose)}
        aria-labelledby={hideLabel ? undefined : "export-purpose-label"}
        aria-label={hideLabel ? "Layout" : undefined}
        className="flex flex-row flex-wrap gap-3"
      >
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            title={opt.hint}
            className={cn(
              "flex items-center gap-1.5 text-xs font-normal",
              disabled && "opacity-50"
            )}
          >
            <RadioGroupItem
              value={opt.value}
              disabled={disabled}
              aria-label={`${opt.label} — ${opt.hint}`}
            />
            {opt.label}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
