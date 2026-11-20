import type { Prisma } from "@prisma/client";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * The teacher filters shared by the Teachers pages of the division, the
 * district portal and the School Head: what kind of advisory a teacher holds,
 * what kind of teacher they are, and (for the two admin pages, which have no
 * status tabs) their account status.
 *
 * DepEd / Non-DepEd follows `classifyAralTeacher` (summary/queries/aral.ts):
 * `employmentType` wins when set; otherwise the volunteer designation reads as
 * Non-DepEd, any other designation as DepEd, and a blank one as not answered.
 * An ARAL tutor is a teacher with at least one live ARAL learner, the rule the
 * ARAL teachers pages use. Every value is validated, never trusted.
 */

export const ADVISORY_FILTERS = ["one", "multi", "floating", "with-section", "no-section"] as const;
export type AdvisoryFilter = (typeof ADVISORY_FILTERS)[number];

export const ADVISORY_FILTER_LABELS: Record<AdvisoryFilter, string> = {
  one: "One advisory",
  multi: "Multi-advisory",
  floating: "Floating",
  "with-section": "Has an advisory section",
  "no-section": "No advisory section",
};

export const TEACHER_TYPE_FILTERS = [
  "aral",
  "not-aral",
  "deped",
  "deped-aral",
  "volunteer",
  "not-answered",
] as const;
export type TeacherTypeFilter = (typeof TEACHER_TYPE_FILTERS)[number];

export const TEACHER_TYPE_FILTER_LABELS: Record<TeacherTypeFilter, string> = {
  aral: "ARAL tutors",
  "not-aral": "Not ARAL tutors",
  deped: "DepEd teachers",
  "deped-aral": "DepEd ARAL tutors",
  volunteer: "Non-DepEd ARAL volunteers",
  "not-answered": "Designation not answered",
};

export const TEACHER_STATUS_FILTERS = [
  "active",
  "pending",
  "inactive",
  "rejected",
  "no-profile",
] as const;
export type TeacherStatusFilter = (typeof TEACHER_STATUS_FILTERS)[number];

export const TEACHER_STATUS_FILTER_LABELS: Record<TeacherStatusFilter, string> = {
  active: "Active",
  pending: "Waiting for approval",
  inactive: "Switched off",
  rejected: "Declined",
  "no-profile": "Profile not finished",
};

export type TeacherFacets = {
  advisory?: AdvisoryFilter;
  teacherType?: TeacherTypeFilter;
  status?: TeacherStatusFilter;
};

function pick<T extends string>(values: readonly T[], raw: string | undefined): T | undefined {
  return raw !== undefined && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** `?advisory=&type=&status=`; unknown values are dropped. */
export function parseTeacherFacets(sp: {
  advisory?: string;
  type?: string;
  status?: string;
}): TeacherFacets {
  return {
    advisory: pick(ADVISORY_FILTERS, sp.advisory),
    teacherType: pick(TEACHER_TYPE_FILTERS, sp.type),
    status: pick(TEACHER_STATUS_FILTERS, sp.status),
  };
}

const LIVE_ARAL_LEARNER = { deletedAt: null, archivedAt: null, isAralLearner: true } as const;

const IS_VOLUNTEER: Prisma.UserWhereInput = {
  teacherProfile: {
    is: {
      OR: [
        { employmentType: "NON_DEPED" },
        { employmentType: null, designation: ARAL_VOLUNTEER_DESIGNATION },
      ],
    },
  },
};

const IS_DEPED: Prisma.UserWhereInput = {
  teacherProfile: {
    is: {
      OR: [
        { employmentType: "DEPED_PLANTILLA" },
        {
          employmentType: null,
          AND: [
            { designation: { not: null } },
            { designation: { not: "" } },
            { designation: { not: ARAL_VOLUNTEER_DESIGNATION } },
          ],
        },
      ],
    },
  },
};

const IS_ARAL_TUTOR: Prisma.UserWhereInput = { aralLearners: { some: LIVE_ARAL_LEARNER } };

/** A volunteer never advises, so the declared modes leave volunteers out. */
function declaredMode(mode: "DEFAULT" | "MULTI_GRADE" | "FLOATING"): Prisma.UserWhereInput {
  return { AND: [{ teacherProfile: { is: { advisoryMode: mode } } }, { NOT: IS_VOLUNTEER }] };
}

function advisoryWhere(f: AdvisoryFilter): Prisma.UserWhereInput {
  switch (f) {
    case "one":
      return declaredMode("DEFAULT");
    case "multi":
      return declaredMode("MULTI_GRADE");
    case "floating":
      return declaredMode("FLOATING");
    case "with-section":
      return { advisorySections: { some: { deletedAt: null } } };
    case "no-section":
      return { advisorySections: { none: { deletedAt: null } } };
  }
}

function typeWhere(f: TeacherTypeFilter): Prisma.UserWhereInput {
  switch (f) {
    case "aral":
      return IS_ARAL_TUTOR;
    case "not-aral":
      return { aralLearners: { none: LIVE_ARAL_LEARNER } };
    case "deped":
      return IS_DEPED;
    case "deped-aral":
      return { AND: [IS_DEPED, IS_ARAL_TUTOR] };
    case "volunteer":
      return IS_VOLUNTEER;
    case "not-answered":
      return { NOT: [IS_DEPED, IS_VOLUNTEER] };
  }
}

/** Same split as the Teachers summary cards (`getTeachersSummary`). */
function statusWhere(f: TeacherStatusFilter): Prisma.UserWhereInput {
  switch (f) {
    case "active":
      return { isActive: true, OR: [{ approvalStatus: "APPROVED" }, { approvalStatus: null }] };
    case "pending":
      return { approvalStatus: "PENDING" };
    case "inactive":
      return { isActive: false, OR: [{ approvalStatus: "APPROVED" }, { approvalStatus: null }] };
    case "rejected":
      return { approvalStatus: "REJECTED" };
    case "no-profile":
      return { profileCompleted: false };
  }
}

/** The `where` fragments for the chosen facets, to AND onto a page's own scope. */
export function teacherFacetWhere(f: TeacherFacets): Prisma.UserWhereInput[] {
  const and: Prisma.UserWhereInput[] = [];
  if (f.advisory) and.push(advisoryWhere(f.advisory));
  if (f.teacherType) and.push(typeWhere(f.teacherType));
  if (f.status) and.push(statusWhere(f.status));
  return and;
}

/** The URL keys these facets write, for list keys and "clear filters". */
export const TEACHER_FACET_KEYS = ["advisory", "type", "status"] as const;

/** "Multi-advisory", "ARAL tutors" — the chosen facets, for a scope caption. */
export function facetScopeLabels(f: TeacherFacets | undefined): string[] {
  if (!f) return [];
  return [
    f.advisory ? ADVISORY_FILTER_LABELS[f.advisory] : undefined,
    f.teacherType ? TEACHER_TYPE_FILTER_LABELS[f.teacherType] : undefined,
    f.status ? TEACHER_STATUS_FILTER_LABELS[f.status] : undefined,
  ].filter((v): v is string => Boolean(v));
}
