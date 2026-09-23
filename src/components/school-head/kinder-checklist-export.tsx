"use client";

import {
  KinderChecklistExportControls,
  type KinderChecklistActionResult,
  type KinderChecklistExportResult,
} from "@/components/terms/kinder-checklist-toolbar";
import { PrintableKinderChecklist } from "@/components/terms/printable-kinder-checklist";
import type { KinderChecklistCellState } from "@/components/terms/kinder-checklist-row";
import type { KinderCompetencyKey } from "@/lib/terms/kinder-competencies";
import { exportKinderChecklist } from "@/lib/actions/kinder-competencies";

export interface SchoolHeadKinderChecklistExportProps {
  learnerId: string;
  learnerName: string;
  schoolName: string;
  advisoryLabel: string;
  schoolYearLabel: string;
  /** The merged 62-entry state from `mergeKinderChecklist`, serialized as entries for the client boundary. */
  entries: readonly (readonly [KinderCompetencyKey, KinderChecklistCellState])[];
}

/**
 * School Head export/print controls for the read-only Kindergarten checklist.
 * A separate client component from `KinderChecklistClient` because that one
 * also owns editing state (dirty tracking, save) that this read-only view must
 * never carry. `exportKinderChecklist`'s `SCHOOL_HEAD` branch derives the
 * school and grade/section from the learner itself (session-scoped), so no
 * `advisorySectionId` is sent here.
 */
export function SchoolHeadKinderChecklistExport({
  learnerId,
  learnerName,
  schoolName,
  advisoryLabel,
  schoolYearLabel,
  entries,
}: SchoolHeadKinderChecklistExportProps) {
  const states = new Map(entries);

  return (
    <>
      <div className="flex justify-end print:hidden">
        <KinderChecklistExportControls
          onExport={(purpose) =>
            exportKinderChecklist({ learnerId, purpose }) as Promise<
              KinderChecklistActionResult<KinderChecklistExportResult>
            >
          }
        />
      </div>

      <div className="hidden print:block">
        <PrintableKinderChecklist
          schoolName={schoolName}
          learnerName={learnerName}
          advisoryLabel={advisoryLabel}
          schoolYearLabel={schoolYearLabel}
          generatedAt={new Date()}
          states={states}
        />
      </div>
    </>
  );
}
