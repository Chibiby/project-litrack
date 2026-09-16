"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Surface } from "@/components/ui/surface";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";

export interface KinderChecklistSchoolHeadSectionOption {
  id: string;
  label: string;
}

export interface KinderChecklistSchoolHeadLearnerOption {
  id: string;
  fullName: string;
}

/**
 * The School Head's read-only checklist picker (spec section 10): a
 * Kindergarten section, then a learner in that section. Query-param driven,
 * same convention as the teacher page's learner selection — never a client
 * state that can drift from the URL a link or a refresh lands on.
 *
 * Changing the section clears any `?learner=` already in the URL, because the
 * previous learner is not guaranteed to belong to the newly chosen section.
 */
export function KinderChecklistSchoolHeadPicker({
  basePath,
  sections,
  learners,
  sectionId,
  learnerId,
}: {
  basePath: string;
  sections: readonly KinderChecklistSchoolHeadSectionOption[];
  learners: readonly KinderChecklistSchoolHeadLearnerOption[];
  sectionId: string | null;
  learnerId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(next: { section?: string; learner?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.section !== undefined) {
      params.set("section", next.section);
      params.delete("learner");
    }
    if (next.learner !== undefined) {
      params.set("learner", next.learner);
    }
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  const sectionOptions: SearchableOption[] = sections.map((s) => ({
    value: s.id,
    label: s.label,
  }));
  const learnerOptions: SearchableOption[] = learners.map((l) => ({
    value: l.id,
    label: l.fullName,
  }));

  return (
    <Surface className="flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:flex-wrap sm:items-end sm:p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
        <span className="text-xs font-medium text-muted-foreground">Kindergarten section</span>
        <SearchableSelect
          options={sectionOptions}
          value={sectionId ?? ""}
          onValueChange={(value) => navigate({ section: value })}
          placeholder="Select a section…"
          searchPlaceholder="Search sections…"
          emptyMessage="No Kindergarten sections."
          disabled={sections.length === 0}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
        <span className="text-xs font-medium text-muted-foreground">Learner</span>
        <SearchableSelect
          options={learnerOptions}
          value={learnerId ?? ""}
          onValueChange={(value) => navigate({ learner: value })}
          placeholder="Select a learner…"
          searchPlaceholder="Search learners…"
          emptyMessage="No learners in this section."
          disabled={!sectionId || learners.length === 0}
        />
      </div>
    </Surface>
  );
}
