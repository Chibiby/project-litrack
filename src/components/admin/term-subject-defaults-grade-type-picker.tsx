"use client";

// Deliberately duplicated from
// `src/components/school-head/term-subjects-grade-picker.tsx` rather than
// generalised: same shape, but this one navigates `?type=` on a grade *type*
// (tenant-less) rather than `?grade=` on a school's own `GradeLevel` row.
// Extraction candidate if a third caller ever needs this pattern.

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";

export function TermSubjectDefaultsGradeTypePicker({
  gradeTypes,
  selectedGradeType,
}: {
  gradeTypes: { id: string; label: string }[];
  selectedGradeType: string;
}) {
  const router = useRouter();

  function hrefFor(gradeType: string): string {
    return `/admin/term-subjects?type=${encodeURIComponent(gradeType)}`;
  }

  return (
    <div className="max-w-xs space-y-1.5">
      <Label htmlFor="term-subject-defaults-grade-type" className="text-xs">
        Grade level
      </Label>
      <select
        id="term-subject-defaults-grade-type"
        value={selectedGradeType}
        onChange={(e) => router.push(hrefFor(e.target.value))}
        className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
      >
        {gradeTypes.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </select>
    </div>
  );
}
