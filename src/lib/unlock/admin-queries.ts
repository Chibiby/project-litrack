import "server-only";
import type { Prisma, UnlockScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TEACHER_ROSTER_STATE } from "@/lib/teachers/roster";

/**
 * Reads behind the Super Admin unlock console.
 *
 * **Deliberately unfiltered by school**, the same trust boundary the support
 * inbox documents in `src/lib/support/queries.ts`: the division admin issues and
 * revokes access across every school, so a `schoolId` filter would be wrong
 * rather than merely restrictive. These functions do NOT check the role —
 * callers must already have established a Super Admin, which
 * `src/lib/actions/unlock-admin.ts` does explicitly and says why.
 *
 * Not actions and not cached. A page whose job is to answer "what is open right
 * now, and until when" must not read a 60-second-old copy of that, and the admin
 * settings routes are `force-dynamic` anyway.
 */

/**
 * The teacher roster's "active" predicate with its tenant half left out.
 *
 * `teacherRosterScope(schoolId)` is these two fields plus a `schoolId` this
 * listing deliberately cannot fix — it spans schools. The state half is taken
 * from `TEACHER_ROSTER_STATE.active` rather than re-typed, so "active" here
 * cannot drift from what the School Head's own Active tab counts, or from who
 * `issueSchoolUnlock` notifies.
 */
const ACTIVE_TEACHER_ANY_SCHOOL: Prisma.UserWhereInput = {
  role: "TEACHER",
  deletedAt: null,
  ...TEACHER_ROSTER_STATE.active,
};

export type ActiveTeacherUnlock = {
  id: string;
  scope: UnlockScope;
  targetKey: string;
  expiresAt: Date;
  createdAt: Date;
  teacherId: string;
  teacherName: string;
  schoolId: string;
  schoolName: string;
  grantedByName: string | null;
};

export type ActiveSchoolUnlock = {
  id: string;
  scope: UnlockScope;
  targetKey: string;
  expiresAt: Date;
  createdAt: Date;
  schoolId: string;
  schoolName: string;
  grantedByName: string | null;
};

export type ActiveUnlocks = {
  teacher: ActiveTeacherUnlock[];
  school: ActiveSchoolUnlock[];
};

/** Live means not revoked and not expired — the same two conditions every read site applies. */
function liveWhere() {
  return { revokedAt: null, expiresAt: { gt: new Date() } };
}

/**
 * Every unlock in force right now, both kinds, newest first.
 *
 * Capped at 100 per kind. The console is a list of exceptions, not a report: if
 * a hundred windows are open at once the answer is not a longer page, it is that
 * submission locking is doing nothing and should be switched off deliberately.
 */
export async function listActiveUnlocks(): Promise<ActiveUnlocks> {
  const [teacherGrants, schoolGrants] = await Promise.all([
    prisma.unlockGrant.findMany({
      where: liveWhere(),
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        scope: true,
        targetKey: true,
        expiresAt: true,
        createdAt: true,
        schoolId: true,
        user: { select: { id: true, fullName: true } },
        school: { select: { name: true } },
        grantedBy: { select: { fullName: true } },
      },
    }),
    prisma.schoolUnlockGrant.findMany({
      where: liveWhere(),
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        scope: true,
        targetKey: true,
        expiresAt: true,
        createdAt: true,
        schoolId: true,
        school: { select: { name: true } },
        grantedBy: { select: { fullName: true } },
      },
    }),
  ]);

  return {
    teacher: teacherGrants.map((grant) => ({
      id: grant.id,
      scope: grant.scope,
      targetKey: grant.targetKey,
      expiresAt: grant.expiresAt,
      createdAt: grant.createdAt,
      teacherId: grant.user.id,
      teacherName: grant.user.fullName?.trim() || "Unnamed teacher",
      schoolId: grant.schoolId,
      schoolName: grant.school?.name ?? "",
      grantedByName: grant.grantedBy?.fullName ?? null,
    })),
    school: schoolGrants.map((grant) => ({
      id: grant.id,
      scope: grant.scope,
      targetKey: grant.targetKey,
      expiresAt: grant.expiresAt,
      createdAt: grant.createdAt,
      schoolId: grant.schoolId,
      schoolName: grant.school?.name ?? "",
      grantedByName: grant.grantedBy?.fullName ?? null,
    })),
  };
}

export type UnlockTargetSchool = {
  id: string;
  name: string;
  teachers: { id: string; name: string }[];
};

/**
 * Every school and its active teachers, for the console's two pickers.
 *
 * "Active" is the teacher roster's own definition
 * (`teacherRosterScope` + `TEACHER_ROSTER_STATE.active`), which is also what
 * `issueSchoolUnlock` notifies. A picker built from a wider rule than the write
 * path accepts is an interface that offers a choice and then refuses it.
 *
 * Soft-deleted schools are excluded; INACTIVE ones are not. A school whose
 * LITRACK access is switched off still has encoding somebody may need reopened,
 * and the caller can say so in the label.
 */
export async function listUnlockTargets(): Promise<UnlockTargetSchool[]> {
  const [schools, teachers] = await Promise.all([
    prisma.school.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { ...ACTIVE_TEACHER_ANY_SCHOOL, school: { deletedAt: null } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        schoolId: true,
        fullName: true,
        firstName: true,
        lastName: true,
      },
    }),
  ]);

  // Two queries rather than a nested relation read, so a school with no active
  // teacher still appears: a school-wide grant covers whoever is employed while
  // it runs, including a teacher hired after it was issued, so an empty staff
  // list is not a reason to hide the school from the picker.
  const bySchool = new Map<string, { id: string; name: string }[]>();
  for (const teacher of teachers) {
    if (!teacher.schoolId) continue;
    const name =
      teacher.fullName?.trim() ||
      [teacher.firstName, teacher.lastName].filter(Boolean).join(" ").trim() ||
      "Unnamed teacher";
    const bucket = bySchool.get(teacher.schoolId);
    if (bucket) bucket.push({ id: teacher.id, name });
    else bySchool.set(teacher.schoolId, [{ id: teacher.id, name }]);
  }

  return schools.map((school) => ({
    id: school.id,
    name: school.name,
    teachers: bySchool.get(school.id) ?? [],
  }));
}
