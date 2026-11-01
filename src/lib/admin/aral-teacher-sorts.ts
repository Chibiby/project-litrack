import { defineSort } from "@/lib/sort/registry";

/** Pure (no `server-only`), so the client table can render the dropdown from it. */
export const ARAL_TEACHER_SORTS = defineSort(
  [
    { value: "name", label: "Name (A–Z)" },
    { value: "learners", label: "Most ARAL learners" },
  ] as const,
  "name"
);

export type AralTeacherSort = (typeof ARAL_TEACHER_SORTS.options)[number]["value"];
