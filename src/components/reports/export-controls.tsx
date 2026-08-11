"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  exportSchoolHeadLearnersExcel,
  exportTeacherLearnersExcel,
} from "@/lib/actions/export-learners";
import { Download, Loader2, Printer } from "lucide-react";

export type ReportSectionOption = {
  id: string;
  name: string;
  gradeLevelId: string;
};

export type ReportExportFilters = {
  gradeLevelId?: string;
  sectionId?: string;
  aralOnly?: boolean;
  schoolId?: string;
};

type Props = {
  role: "TEACHER" | "SCHOOL_HEAD";
  gradeLevelId?: string;
  schoolId?: string;
  grades?: { id: string; label: string }[];
  sections?: ReportSectionOption[];
  /** When set, Print loads/refreshes printable data with current filters first. */
  onPrint?: (filters: ReportExportFilters) => void | Promise<void>;
};

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

export function ExportControls({
  role,
  gradeLevelId,
  schoolId,
  grades,
  sections = [],
  onPrint,
}: Props) {
  const [aralOnly, setAralOnly] = useState(false);
  const [selectedGrade, setSelectedGrade] = useState(gradeLevelId ?? "");
  const [selectedSection, setSelectedSection] = useState("");
  const [pending, startTransition] = useTransition();

  const sectionOptions = useMemo(() => {
    if (!selectedGrade) return sections;
    return sections.filter((s) => s.gradeLevelId === selectedGrade);
  }, [sections, selectedGrade]);

  function currentFilters(): ReportExportFilters {
    return {
      gradeLevelId: selectedGrade || undefined,
      sectionId: selectedSection || undefined,
      aralOnly,
      schoolId,
    };
  }

  function handleGradeChange(value: string) {
    setSelectedGrade(value);
    setSelectedSection("");
  }

  function handleExcel() {
    startTransition(async () => {
      const filter = currentFilters();
      const res =
        role === "TEACHER"
          ? await exportTeacherLearnersExcel(filter)
          : await exportSchoolHeadLearnersExcel(filter);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      downloadBase64Xlsx(res.data.base64, res.data.filename);
      toast.success("Excel downloaded");
    });
  }

  function handlePrint() {
    if (!onPrint) {
      window.print();
      return;
    }
    startTransition(async () => {
      await onPrint(currentFilters());
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 print:hidden sm:flex-row sm:flex-wrap sm:items-end">
      {grades && grades.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Grade filter</span>
          <select
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            value={selectedGrade}
            onChange={(e) => handleGradeChange(e.target.value)}
            aria-label="Filter by grade"
          >
            <option value="">All grades</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {sections.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Section filter</span>
          <select
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            aria-label="Filter by section"
          >
            <option value="">All sections</option>
            <option value="none">No section</option>
            {sectionOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center gap-2 pb-2">
        <Checkbox
          id="aralOnly"
          checked={aralOnly}
          onCheckedChange={(v) => setAralOnly(v === true)}
        />
        <Label htmlFor="aralOnly" className="text-sm font-normal">
          ARAL learners only
        </Label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleExcel} disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download Excel
        </Button>
        <Button type="button" variant="outline" onClick={handlePrint} disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Printer className="h-4 w-4" />
          )}{" "}
          Print / Save PDF
        </Button>
      </div>
    </div>
  );
}
