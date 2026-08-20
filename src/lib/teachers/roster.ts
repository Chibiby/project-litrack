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
  advisorySection: {
    select: { id: true, name: true, gradeLevel: { select: { type: true } } },
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
    // A teacher sets this in profiling; the School Head can change it from the
    // Active teachers table (see `setTeacherAdvisorySection`).
    assignment: t.advisorySection
      ? {
          sectionId: t.advisorySection.id,
          gradeName:
            GRADE_LEVEL_LABELS[t.advisorySection.gradeLevel.type] ??
            t.advisorySection.gradeLevel.type,
          sectionName: t.advisorySection.name,
        }
      : null,
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
