"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  exportSchoolHeadLearnersExcel,
  exportTeacherLearnersExcel,
} from "@/lib/actions/export-learners";
import { Download, Loader2, Printer } from "lucide-react";

type Props = {
  role: "TEACHER" | "SCHOOL_HEAD";
  gradeLevelId?: string;
  schoolId?: string;
  grades?: { id: string; label: string }[];
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

export function ExportControls({ role, gradeLevelId, schoolId, grades }: Props) {
  const [aralOnly, setAralOnly] = useState(false);
  const [selectedGrade, setSelectedGrade] = useState(gradeLevelId ?? "");
  const [pending, startTransition] = useTransition();

  function handleExcel() {
    startTransition(async () => {
      const filter = {
        gradeLevelId: selectedGrade || undefined,
        aralOnly,
        schoolId,
      };
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

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 print:hidden sm:flex-row sm:flex-wrap sm:items-end">
      {grades && grades.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Grade filter</span>
          <select
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            value={selectedGrade}
            onChange={(e) => setSelectedGrade(e.target.value)}
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
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Save PDF
        </Button>
      </div>
    </div>
  );
}
