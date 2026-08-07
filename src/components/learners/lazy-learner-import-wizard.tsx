"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

function ImportWizardFallback() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-10 w-32" />
    </div>
  );
}

/** Code-split papaparse-heavy import wizard off the shared teacher bundle. */
export const LearnerImportWizard = dynamic(
  () =>
    import("@/components/learners/learner-import-wizard").then(
      (m) => m.LearnerImportWizard
    ),
  { ssr: false, loading: () => <ImportWizardFallback /> }
);
