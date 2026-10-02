import { defineSort } from "@/lib/sort/registry";

/** Pure (no `server-only`), so the client table can render the dropdown from it. */
export const ARAL_TUTOR_SORTS = defineSort(
  [
    { value: "name", label: "Name (A–Z)" },
    { value: "learners", label: "Most ARAL learners" },
  ] as const,
  "name"
);

export type AralTutorSort = (typeof ARAL_TUTOR_SORTS.options)[number]["value"];
