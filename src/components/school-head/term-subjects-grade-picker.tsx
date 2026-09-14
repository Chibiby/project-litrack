"use client";

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Which grade's sheet the management page is showing. A `?grade=` navigation
 * rather than local state: the active grade decides which subjects the server
 * loads, and a URL the head can bookmark or share beats a picker that resets
 * on refresh.
 */
export function TermSubjectsGradePicker({
  grades,
  selectedGradeId,
  schoolIdParam,
}: {
  grades: { id: string; label: string }[];
  selectedGradeId: string;
  /** Carried through so a Super Admin's drill-down survives the grade switch. */
  schoolIdParam?: string;
}) {
  const router = useRouter();

  function hrefFor(gradeId: string): string {
    const qs = new URLSearchParams({ grade: gradeId });
    if (schoolIdParam) qs.set("schoolId", schoolIdParam);
    return `${SCHOOL_HEAD_ROUTES.termSubjects}?${qs.toString()}`;
  }

  return (
    <div className="max-w-xs space-y-1.5">
      <Label htmlFor="term-subjects-grade" className="text-xs">
        Grade level
      </Label>
      <select
        id="term-subjects-grade"
        value={selectedGradeId}
        onChange={(e) => router.push(hrefFor(e.target.value))}
        className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
      >
        {grades.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </select>
    </div>
  );
}
