"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ExportControls,
  type ReportExportFilters,
  type ReportSectionOption,
} from "@/components/reports/export-controls";
import { PrintableLearnersReport } from "@/components/reports/printable-learners-report";
import {
  fetchPrintableReport,
  type PrintableReportData,
} from "@/lib/actions/export-learners";
import { FileText } from "lucide-react";

type Props = {
  role: "TEACHER" | "SCHOOL_HEAD";
  schoolId: string;
  grades: { id: string; label: string }[];
  sections: ReportSectionOption[];
  subtitle: string;
};

function filtersKey(filters: ReportExportFilters): string {
  return JSON.stringify({
    gradeLevelId: filters.gradeLevelId ?? "",
    sectionId: filters.sectionId ?? "",
    aralOnly: Boolean(filters.aralOnly),
  });
}

/**
 * Reports chrome: Excel stays on-demand; printable summary loads only when asked
 * (avoids full-school/teacher learner dumps on every reports page visit).
 */
export function OnDemandReportPanel({
  role,
  schoolId,
  grades,
  sections,
  subtitle,
}: Props) {
  const [report, setReport] = useState<PrintableReportData | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [pending, startTransition] = useTransition();
  const printWhenReady = useRef(false);

  useEffect(() => {
    if (printWhenReady.current && report) {
      printWhenReady.current = false;
      window.print();
    }
  }, [report, loadedKey]);

  async function ensureReport(filters: ReportExportFilters): Promise<boolean> {
    const key = filtersKey(filters);
    if (report && loadedKey === key) return true;

    const res = await fetchPrintableReport({
      scope: role,
      schoolId,
      gradeLevelId: filters.gradeLevelId,
      sectionId: filters.sectionId,
      aralOnly: filters.aralOnly,
    });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setReport(res.data);
    setLoadedKey(key);
    return true;
  }

  return (
    <>
      <div className="mb-4 space-y-4">
        <ExportControls
          role={role}
          schoolId={schoolId}
          grades={grades}
          sections={sections}
          onPrint={async (filters) => {
            const key = filtersKey(filters);
            if (report && loadedKey === key) {
              window.print();
              return;
            }
            printWhenReady.current = true;
            const ok = await ensureReport(filters);
            if (!ok) printWhenReady.current = false;
          }}
        />
      </div>

      {report ? (
        <div className="rounded-xl border border-border bg-card p-6 print:border-0 print:p-0">
          <PrintableLearnersReport
            schoolName={report.schoolName}
            generatedAt={report.generatedAt}
            learners={report.learners}
            aralCount={report.aralCount}
            byGrade={report.byGrade}
            byGradeSection={report.byGradeSection}
            subtitle={subtitle}
          />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-card/50 p-8 print:hidden">
          <p className="text-sm text-muted-foreground">
            Printable summary is loaded on demand so this page stays light. Use
            Download Excel anytime, or load the summary before Print / Save PDF.
          </p>
          <Button
            type="button"
            variant="outline"
            loading={pending}
            loadingText="Loading summary…"
            onClick={() => {
              startTransition(async () => {
                await ensureReport({});
              });
            }}
          >
            <FileText className="h-4 w-4" />
            Load printable summary
          </Button>
        </div>
      )}
    </>
  );
}
