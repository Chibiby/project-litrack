import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import type { ActiveTeacherRow } from "@/components/teachers-active-table";
import type { TeacherTabCounts } from "@/components/school-head/workspace-tabs";

/**
 * Shared query shapes for the School Head teacher roster.
 *
 * The four roster states used to be four tables on one page, so a single
 * `where` fragment and a single row mapper served all of them. They are four
 * sibling routes now, and four copies of `{ role: "TEACHER", deletedAt: null }`
 * is exactly the kind of drift that ends with one tab counting soft-deleted
 * teachers and another not. Everything the tabs must agree on lives here.
 *
 * Not `server-only`: the type exports are pulled in by page modules that also
 * import client components, and the runtime helper is only ever awaited from a
 * server component.
 */

/**
 * Every roster query starts here. `schoolId` is the tenant boundary and is
 * never optional — a teacher list without it would span schools.
 */
export function teacherRosterScope(schoolId: string): Prisma.UserWhereInput {
  return { schoolId, role: "TEACHER", deletedAt: null };
}

/**
 * The four states, as `where` fragments to spread over `teacherRosterScope`.
 *
 * Pending and Declined deliberately ignore `isActive`: it is meaningless before
 * approval, and filtering on it would hide a request whose flag happens to be
 * off. Active and Inactive are both `APPROVED` and split on that flag alone.
 */
export const TEACHER_ROSTER_STATE = {
  active: { approvalStatus: "APPROVED", isActive: true },
  pending: { approvalStatus: "PENDING" },
  inactive: { approvalStatus: "APPROVED", isActive: false },
  declined: { approvalStatus: "REJECTED" },
} satisfies Record<keyof TeacherTabCounts, Prisma.UserWhereInput>;

/**
 * Columns the Active and Inactive tables render. The two `_count`s filter
 * `deletedAt: null` so an archived learner stops counting against a teacher.
 */
export const managedTeacherSelect = {
  id: true,
  fullName: true,
  email: true,
  profileCompleted: true,
  approvedAt: true,
  // A LIST since Wave A of multi-advisory: a teacher may advise up to three.
  //
  // The archived-section filter (§6) now lives in the select itself, where it
  // belongs — a list relation accepts a `where`, which the old to-one
  // `advisorySection` did not, so `toManagedRow` no longer has to drop rows
  // after the fact. Same rule, one query earlier.
  advisorySections: {
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      gradeLevel: { select: { type: true } },
    },
    orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
  },
  _count: {
    select: {
      managedLearners: { where: { deletedAt: null } },
      aralLearners: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.UserSelect;

export type ManagedTeacher = Prisma.UserGetPayload<{
  select: typeof managedTeacherSelect;
}>;

export function toManagedRow(t: ManagedTeacher): ActiveTeacherRow {
  return {
    id: t.id,
    fullName: t.fullName,
    email: t.email,
    profileCompleted: t.profileCompleted,
    approvedAt: t.approvedAt?.toISOString() ?? null,
    learnerCount: t._count.managedLearners,
    aralLearnerCount: t._count.aralLearners,
    // A teacher sets their first in profiling; the School Head adds and removes
    // from the Active teachers table (see `setTeacherAdvisorySection`).
    //
    // Empty rather than null for "advises nothing" — one shape, so no caller has
    // to handle both an absent list and an empty one. Archived sections are
    // already excluded by the select above: a teacher holding only archived
    // sections reads as unassigned, which is what they are.
    assignments: t.advisorySections.map((section) => ({
      sectionId: section.id,
      gradeName:
        GRADE_LEVEL_LABELS[section.gradeLevel.type] ?? section.gradeLevel.type,
      sectionName: section.name,
    })),
  };
}

/**
 * Badge numbers for the tab bar. Every tab renders the same four, so they are
 * fetched the same way on all four routes and cannot disagree.
 *
 * Unfiltered on purpose: the Active tab has a search box, and a badge that
 * moved while you typed would read as teachers disappearing from the school
 * rather than from the current page. Pagination uses its own filtered count.
 *
 * Four counts rather than one `groupBy`: they run concurrently in the
 * `Promise.all` below, the roster is a few dozen rows per school, and the
 * `where` fragments stay readable next to the `findMany` that renders the tab.
 */
export async function teacherTabCounts(
  schoolId: string
): Promise<TeacherTabCounts> {
  const scope = teacherRosterScope(schoolId);
  const [active, pending, inactive, declined] = await Promise.all([
    prisma.user.count({ where: { ...scope, ...TEACHER_ROSTER_STATE.active } }),
    prisma.user.count({ where: { ...scope, ...TEACHER_ROSTER_STATE.pending } }),
    prisma.user.count({ where: { ...scope, ...TEACHER_ROSTER_STATE.inactive } }),
    prisma.user.count({ where: { ...scope, ...TEACHER_ROSTER_STATE.declined } }),
  ]);
  return { active, pending, inactive, declined };
}
