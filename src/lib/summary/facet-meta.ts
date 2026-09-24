import { SUMMARY_FACET_IDS, type SummaryFacetId } from "@/lib/summary/types";

/**
 * The summary facets' names, in nav order. Client-safe (no Prisma), so nav and
 * client components can read it; `src/lib/summary/facets.ts` is the server
 * registry that adds `load` and `toReportTable` to each of these.
 */
export type SummaryFacetMeta = {
  id: SummaryFacetId;
  label: string;
  description: string;
  /** Which params the facet's page offers. */
  paramKinds: readonly ("month" | "monthRange" | "schoolYearTerm")[];
};

export const SUMMARY_FACET_META: Record<SummaryFacetId, SummaryFacetMeta> = {
  learners: {
    id: "learners",
    label: "Learners",
    description: "Age, gender, reading profile, 4Ps, parents' education, transport, distance and transfers.",
    paramKinds: [],
  },
  "reading-behavior": {
    id: "reading-behavior",
    label: "Reading behaviour",
    description: "ARAL learners' word recognition and reading comprehension level for one month.",
    paramKinds: ["month"],
  },
  "end-of-term": {
    id: "end-of-term",
    label: "End of term",
    description: "Average per subject and learners scoring 80 or above, per term.",
    paramKinds: ["schoolYearTerm"],
  },
  attendance: {
    id: "attendance",
    label: "Weekly attendance",
    description: "ARAL attendance rate per week and per month, and schools with none recorded.",
    paramKinds: ["monthRange"],
  },
  "reading-levels": {
    id: "reading-levels",
    label: "Monthly reading level",
    description: "ARAL learners' reading level per month and how many moved up.",
    paramKinds: ["monthRange"],
  },
  compliance: {
    id: "compliance",
    label: "Non-compliance",
    description: "Schools with no data, pending items, stale or incomplete records, or discrepancies.",
    paramKinds: [],
  },
  profiling: {
    id: "profiling",
    label: "Teacher and School Head profiling",
    description: "Designation, position, education, specialization, service and trainings.",
    paramKinds: [],
  },
};

/** Every facet in nav order. */
export const SUMMARY_FACET_LIST: readonly SummaryFacetMeta[] = SUMMARY_FACET_IDS.map(
  (id) => SUMMARY_FACET_META[id]
);

export function isSummaryFacetId(value: unknown): value is SummaryFacetId {
  return typeof value === "string" && (SUMMARY_FACET_IDS as readonly string[]).includes(value);
}
