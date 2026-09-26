"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { schoolWhereForScope } from "@/lib/auth/admin-scope";
import { teacherLearnerScope } from "@/lib/teachers/scope";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { action } from "@/lib/errors/action";
import {
  GLOBAL_SEARCH_MIN_CHARS,
  type GlobalSearchHit,
} from "@/lib/search/global";

/**
 * Header search. One action for every role, because the alternative — a separate
 * endpoint per role — is three places for a tenant predicate to be forgotten.
 *
 * Two rules hold for every branch below and are the reason this file is short:
 *
 *   1. Nothing is queried without a tenant predicate. A School Head and a Teacher
 *      are pinned to `user.schoolId`; only a Super Admin searches across schools,
 *      and only because that is their documented role. `requireUser()` with no
 *      argument means every signed-in role reaches this code, so the branch —
 *      not the guard — is what scopes the data.
 *   2. A Teacher sees only their own learners (`teacherLearnerScope`), never the
 *      whole school roster, and no teacher/section/school results at all. The
 *      header is not a place to widen what a role can see.
 *
 * A District Admin is its own explicit branch, checked before any of the
 * above: `requireAdminScope()` narrows to `schoolWhereForScope(scope)`, and
 * ONLY schools are ever queried for this role — no learner query and no
 * teacher query run at all (`docs/specs/district-admin.md`, non-goal: "No
 * learner-level lists in the district portal"). Without this branch a district
 * admin would fall through to `!isAdmin && !user.schoolId` below (their
 * `schoolId` is always NULL) and get an empty result — safe, but useless.
 *
 * Soft-deleted rows are excluded everywhere (`deletedAt: null`); archived
 * learners are excluded too, matching the transfer typeahead.
 */

/** Per-group cap. Small on purpose: this is a jump-to box, not a report. */
const PER_GROUP_TAKE = 5;

export const globalSearch = action(
  "globalSearch",
  async (input: { q: string }): Promise<{ ok: true; data: GlobalSearchHit[] }> => {
    const user = await requireUser();

    const q = (input?.q ?? "").trim();
    if (q.length < GLOBAL_SEARCH_MIN_CHARS) return { ok: true, data: [] };

    if (user.role === "DISTRICT_ADMIN") {
      return { ok: true, data: await districtAdminSearch(q) };
    }

    const isAdmin = user.role === "SUPER_ADMIN";
    const isTeacher = user.role === "TEACHER" && !isAdmin;

    // A non-admin with no school can match nothing. Returning empty is not a
    // formality: without it, `schoolId: undefined` would drop the predicate from
    // the `where` entirely and search every tenant.
    if (!isAdmin && !user.schoolId) return { ok: true, data: [] };
    const schoolScope = isAdmin ? {} : { schoolId: user.schoolId as string };

    const contains = { contains: q, mode: "insensitive" as const };
    const hits: GlobalSearchHit[] = [];

    const learners = await prisma.learner.findMany({
      where: {
        ...schoolScope,
        deletedAt: null,
        archivedAt: null,
        fullName: contains,
        ...(isTeacher ? teacherLearnerScope(user.id) : {}),
      },
      select: {
        id: true,
        fullName: true,
        gradeLevelId: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
      take: PER_GROUP_TAKE,
    });

    for (const l of learners) {
      const grade = GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type;
      hits.push({
        id: l.id,
        kind: "learner",
        title: l.fullName,
        subtitle: l.section ? `${grade} · ${l.section.name}` : grade,
        // The learner profile lives under the grade for a teacher and under the
        // school-head roster otherwise; both routes already exist.
        href: isTeacher
          ? `/teacher/grade/${l.gradeLevelId}/learners/${l.id}`
          : `/school-head/learners?q=${encodeURIComponent(l.fullName)}`,
      });
    }

    // A teacher stops here. Staff and structure are not theirs to browse.
    if (isTeacher) return { ok: true, data: hits };

    const teachers = await prisma.user.findMany({
      where: {
        ...schoolScope,
        role: "TEACHER",
        deletedAt: null,
        fullName: contains,
      },
      select: {
        id: true,
        fullName: true,
        advisorySections: { where: { deletedAt: null }, select: { name: true } },
      },
      orderBy: { fullName: "asc" },
      take: PER_GROUP_TAKE,
    });

    for (const t of teachers) {
      hits.push({
        id: t.id,
        kind: "teacher",
        title: t.fullName,
        // Archived sections are excluded by the select. All live ones are listed:
        // a result naming one of three classes would read as the whole answer.
        subtitle:
          t.advisorySections.length > 0
            ? `Adviser · ${t.advisorySections.map((s) => s.name).join(", ")}`
            : "Teacher",
        href: `/school-head/teachers?q=${encodeURIComponent(t.fullName)}`,
      });
    }

    const sections = await prisma.section.findMany({
      where: { ...schoolScope, deletedAt: null, name: contains },
      select: {
        id: true,
        name: true,
        gradeLevel: { select: { type: true } },
      },
      orderBy: { name: "asc" },
      take: PER_GROUP_TAKE,
    });

    for (const s of sections) {
      hits.push({
        id: s.id,
        kind: "section",
        title: s.name,
        subtitle: GRADE_LEVEL_LABELS[s.gradeLevel.type] ?? s.gradeLevel.type,
        href: `/school-head/school`,
      });
    }

    // Schools are a Super Admin concept; a School Head has exactly one and does
    // not need to search for it.
    if (isAdmin) {
      const schools = await prisma.school.findMany({
        where: { deletedAt: null, name: contains },
        select: { id: true, name: true, division: true, district: true },
        orderBy: { name: "asc" },
        take: PER_GROUP_TAKE,
      });

      for (const s of schools) {
        hits.push({
          id: s.id,
          kind: "school",
          title: s.name,
          subtitle: [s.division, s.district].filter(Boolean).join(" · ") || null,
          href: `/admin/schools?q=${encodeURIComponent(s.name)}`,
        });
      }
    }

    return { ok: true, data: hits };
  },
  { verb: "search" }
);

/**
 * A district admin's header search: schools in their own districts only.
 *
 * `requireAdminScope()` here is a second, cheap call — `requireUser()` above
 * already proved the signed-in role, and `requireAdminScope`'s own guard is
 * memoized per request with React `cache()` (`src/lib/auth/district-scope.ts`),
 * so this does not re-run the assignment lookup. It is called explicitly
 * anyway rather than trusting `user.role` alone, so the scope this function
 * queries with is always the one the admin console itself would compute.
 */
async function districtAdminSearch(q: string): Promise<GlobalSearchHit[]> {
  const { scope } = await requireAdminScope();

  const schools = await prisma.school.findMany({
    where: { ...schoolWhereForScope(scope), name: { contains: q, mode: "insensitive" as const } },
    select: { id: true, name: true, district: true },
    orderBy: { name: "asc" },
    take: PER_GROUP_TAKE,
  });

  return schools.map((s) => ({
    id: s.id,
    kind: "school" as const,
    title: s.name,
    subtitle: s.district,
    href: DISTRICT_ROUTES.school(s.id),
  }));
}
