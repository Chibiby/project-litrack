"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { LearnerListSectionFilter } from "@/lib/learners/pagination";
import type { SectionOption } from "@/components/learners/learner-list-toolbar";

type Props = {
  gradeId: string;
  section: LearnerListSectionFilter;
  sections: SectionOption[];
  schoolId?: string;
};

export function AralSectionFilter({
  gradeId,
  section,
  sections,
  schoolId,
}: Props) {
  const path = `/teacher/aral/${gradeId}`;

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border/60 p-4">
      <form
        method="get"
        action={path}
        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        {schoolId && <input type="hidden" name="schoolId" value={schoolId} />}
        <label className="flex items-center gap-1.5">
          Section
          <select
            name="section"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            defaultValue={section === "all" ? "" : section}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            aria-label="Filter ARAL learners by section"
          >
            <option value="">All sections</option>
            <option value="none">No section</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </form>
      {section !== "all" && (
        <Button asChild size="sm" variant="outline">
          <Link href={schoolId ? `${path}?schoolId=${schoolId}` : path}>
            Reset
          </Link>
        </Button>
      )}
    </div>
  );
}
