"use client";

import { useEffect } from "react";
import { auditPrintableReport } from "@/lib/actions/export-learners";

/** Fire-and-forget audit when the printable report page mounts. */
export function ReportPrintAudit({
  scope,
  schoolId,
}: {
  scope: "TEACHER" | "SCHOOL_HEAD";
  schoolId: string;
}) {
  useEffect(() => {
    void auditPrintableReport({ scope, schoolId });
  }, [scope, schoolId]);

  return null;
}
