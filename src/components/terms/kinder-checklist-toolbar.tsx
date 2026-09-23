"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { AdvisorySelect } from "@/components/learners/advisory-select";
import {
  ExportPurposeToggle,
  useExportPurpose,
  type ExportPurpose,
} from "@/components/reports/export-purpose-toggle";

export type KinderChecklistLearnerOption = { id: string; fullName: string };
export type KinderChecklistAdvisoryOption = { id: string; label: string };

export type KinderChecklistExportResult = { filename: string; base64: string };

/**
 * `saveKinderCompetencies`/`exportKinderChecklist` (`src/lib/actions/kinder-competencies.ts`,
 * spec section 6/8) had not landed when this file was written, so the result
 * shape is declared locally. It mirrors the house `action()` wrapper's
 * `{ ok: true, data } | { ok: false, error }` contract — keep in sync.
 */
export type KinderChecklistActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function downloadBase64Xlsx(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The Excel-download + browser-print combo every v2 export panel shares
 * (`src/components/reports/export-controls.tsx`) — same two-button, two-busy-state
 * shape, scoped to one learner's checklist instead of a roster.
 */
export function KinderChecklistExportControls({
  disabled = false,
  onExport,
  onPrint,
}: {
  disabled?: boolean;
  onExport: (
    purpose: ExportPurpose
  ) => Promise<KinderChecklistActionResult<KinderChecklistExportResult>>;
  /** When omitted, Print calls `window.print()` directly, same as `ExportControls`. */
  onPrint?: () => void | Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"excel" | "print" | null>(null);
  const [purpose, setPurpose] = useExportPurpose();

  function handleExcel() {
    setBusy("excel");
    startTransition(async () => {
      try {
        const res = await onExport(purpose);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        downloadBase64Xlsx(res.data.base64, res.data.filename);
        toast.success("Excel downloaded");
      } finally {
        setBusy(null);
      }
    });
  }

  function handlePrint() {
    if (!onPrint) {
      window.print();
      return;
    }
    setBusy("print");
    startTransition(async () => {
      try {
        await onPrint();
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <ExportPurposeToggle value={purpose} onChange={setPurpose} disabled={disabled} />
      <Button
        type="button"
        variant="outline"
        onClick={handleExcel}
        loading={busy === "excel"}
        loadingText="Preparing Excel…"
        disabled={disabled || pending}
        className="h-10 shrink-0 rounded-xl px-3"
      >
        <Download className="size-4" aria-hidden />
        <span className="hidden sm:inline">Download Excel</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={handlePrint}
        loading={busy === "print"}
        loadingText="Preparing…"
        disabled={disabled || pending}
        className="h-10 shrink-0 rounded-xl px-3"
      >
        <Printer className="size-4" aria-hidden />
        <span className="hidden sm:inline">Print / Save PDF</span>
      </Button>
    </div>
  );
}

export interface KinderChecklistToolbarProps {
  /** The resolved advisory's roster, for the learner picker. */
  learners: readonly KinderChecklistLearnerOption[];
  /** A learner id, or `null` before one is picked. */
  learnerId: string | null;
  onLearnerChange: (learnerId: string) => void;
  /**
   * The teacher's Kindergarten advisories. Rendered as a chooser only when
   * there is more than one — a single advisory needs no picker, and this
   * component never falls back to `advisories[0]` on the caller's behalf.
   */
  advisories: readonly KinderChecklistAdvisoryOption[];
  /** A section id, or `null` while the advisory is "unspecified" (spec section 4). */
  advisoryId: string | null;
  onAdvisoryChange: (advisorySectionId: string | null) => void;
  onExport: (
    purpose: ExportPurpose
  ) => Promise<KinderChecklistActionResult<KinderChecklistExportResult>>;
  onPrint?: () => void | Promise<void>;
}

/**
 * The learner picker (a searchable select, per the owner's decision), the
 * Kindergarten advisory chooser when the teacher holds more than one, and the
 * export/print controls.
 */
export function KinderChecklistToolbar({
  learners,
  learnerId,
  onLearnerChange,
  advisories,
  advisoryId,
  onAdvisoryChange,
  onExport,
  onPrint,
}: KinderChecklistToolbarProps) {
  const learnerOptions: SearchableOption[] = learners.map((l) => ({
    value: l.id,
    label: l.fullName,
  }));
  const showAdvisoryChooser = advisories.length > 1;

  return (
    <Surface className="flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:flex-wrap sm:items-end sm:p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
        <span className="text-xs font-medium text-muted-foreground" id="kinder-checklist-learner-label">
          Learner
        </span>
        <SearchableSelect
          options={learnerOptions}
          value={learnerId ?? ""}
          onValueChange={onLearnerChange}
          placeholder="Select a learner…"
          searchPlaceholder="Search learners…"
          emptyMessage="No learners in this section."
          disabled={learners.length === 0}
        />
      </div>

      {showAdvisoryChooser ? (
        <div className="flex flex-col gap-1 sm:w-56">
          <span className="text-xs font-medium text-muted-foreground">Kindergarten advisory</span>
          <AdvisorySelect
            advisories={advisories}
            value={advisoryId}
            onChange={onAdvisoryChange}
            className="h-10 w-full"
          />
        </div>
      ) : null}

      <KinderChecklistExportControls
        disabled={!learnerId}
        onExport={onExport}
        onPrint={onPrint}
      />
    </Surface>
  );
}
