"use server";

import { Prisma, type GradeLevelType, type User } from "@prisma/client";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { requireUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { revalidateTermSubjects } from "@/lib/cache/revalidate";
import { BULK_TX_OPTIONS } from "@/lib/db/bulk-write";
import {
  FLOATING_GRADE_MESSAGE,
  MAX_ACTIVE_SUBJECTS_PER_GRADE,
  nextPosition,
  planSubjectReorder,
  planSubjectReset,
} from "@/lib/terms/subjects";
import {
  getActiveDefaultsForType,
  getAllTermSubjects,
  getManagedTermSubjects,
  type TermSubjectRow,
} from "@/lib/terms/subjects-db";
import {
  createTermSubjectSchema,
  renameTermSubjectSchema,
  reorderTermSubjectsSchema,
  resetSchoolTermSubjectsSchema,
  termSubjectGradeSchema,
  termSubjectIdSchema,
} from "@/lib/validators/term-subject.schema";

/**
 * School Head management of each grade's End of Terms subjects.
 *
 * AUTH. `requireUser("SCHOOL_HEAD")` admits School Heads and Super Admins only.
 * TENANCY. A School Head's lookups carry `schoolId: user.schoolId` in the where
 * and are re-checked with `assertSameSchool` (generic NOT_FOUND). A Super Admin
 * is cross-tenant by design: the target row is loaded by id and ITS `schoolId`
 * scopes every later query and the audit row. No payload carries a `schoolId`.
 */

const NAME_TAKEN = "A subject with that name is already on this grade's sheet";
const LIST_CHANGED = "The subject list changed. Reload and try again.";
const CAP_REACHED = `A grade can have at most ${MAX_ACTIVE_SUBJECTS_PER_GRADE} subjects. Remove one first.`;

type LiveGrade = { id: string; schoolId: string };

async function requireEditor() {
  return requireUser("SCHOOL_HEAD");
}

/** A live, non-FLOATING grade the caller may edit. */
async function loadGrade(
  client: Prisma.TransactionClient | typeof prisma,
  user: User,
  gradeLevelId: string
): Promise<LiveGrade> {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!isSuperAdmin && !user.schoolId) throw resourceNotFound("Grade level");

  const grade = await client.gradeLevel.findFirst({
    where: {
      id: gradeLevelId,
      deletedAt: null,
      ...(isSuperAdmin ? {} : { schoolId: user.schoolId! }),
    },
    select: { id: true, schoolId: true, type: true },
  });
  if (!grade) throw resourceNotFound("Grade level");
  if (!isSuperAdmin) assertSameSchool(user.schoolId!, grade.schoolId, "Grade level");
  if (grade.type === "FLOATING") {
    throw new AppError("VALIDATION_FAILED", { params: { message: FLOATING_GRADE_MESSAGE } });
  }
  return { id: grade.id, schoolId: grade.schoolId };
}

/** A subject row (active or archived) whose grade is live, non-FLOATING and editable. */
async function loadSubject(user: User, id: string) {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!isSuperAdmin && !user.schoolId) throw resourceNotFound("Subject");

  const subject = await prisma.termSubject.findFirst({
    where: { id, ...(isSuperAdmin ? {} : { schoolId: user.schoolId! }) },
    select: {
      id: true,
      name: true,
      schoolId: true,
      gradeLevelId: true,
      deletedAt: true,
      gradeLevel: { select: { type: true, deletedAt: true } },
    },
  });
  if (!subject || subject.gradeLevel.deletedAt !== null) throw resourceNotFound("Subject");
  if (!isSuperAdmin) assertSameSchool(user.schoolId!, subject.schoolId, "Subject");
  if (subject.gradeLevel.type === "FLOATING") {
    throw new AppError("VALIDATION_FAILED", { params: { message: FLOATING_GRADE_MESSAGE } });
  }
  return subject;
}

/** Serialises subject edits per grade so the cap and positions stay honest. */
async function lockGrade(tx: Prisma.TransactionClient, gradeLevelId: string) {
  await tx.$queryRaw`SELECT "id" FROM "GradeLevel" WHERE "id" = ${gradeLevelId} FOR UPDATE`;
}

function isNameClash(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function nameTaken(cause: unknown): AppError {
  return new AppError("VALIDATION_FAILED", {
    params: { message: NAME_TAKEN },
    fieldErrors: { name: NAME_TAKEN },
    cause,
  });
}

function activeCount(rows: TermSubjectRow[]): number {
  return rows.filter((r) => r.deletedAt === null).length;
}

/** Read loader for the management page: active (display order) and archived rows. */
export const getTermSubjects = action(
  "getTermSubjects",
  async (
    input: unknown
  ): Promise<{
    ok: true;
    data: {
      gradeLevelId: string;
      max: number;
      active: { id: string; name: string; position: number }[];
      archived: { id: string; name: string; deletedAt: string }[];
    };
  }> => {
    const user = await requireEditor();
    const { gradeLevelId } = parseInput(termSubjectGradeSchema, input);
    const grade = await loadGrade(prisma, user, gradeLevelId);
    const { active, archived } = await getManagedTermSubjects(prisma, {
      schoolId: grade.schoolId,
      gradeLevelId: grade.id,
    });
    return {
      ok: true,
      data: {
        gradeLevelId: grade.id,
        max: MAX_ACTIVE_SUBJECTS_PER_GRADE,
        active: active.map(({ id, name, position }) => ({ id, name, position })),
        archived: archived.map(({ id, name, deletedAt }) => ({
          id,
          name,
          deletedAt: (deletedAt as Date).toISOString(),
        })),
      },
    };
  },
  { verb: "load the subjects" }
);

export const createTermSubject = action(
  "createTermSubject",
  async (input: unknown): Promise<{ ok: true; data: { id: string } }> => {
    const user = await requireEditor();
    const { gradeLevelId, name } = parseInput(createTermSubjectSchema, input);
    const grade = await loadGrade(prisma, user, gradeLevelId);

    let created: { id: string };
    try {
      created = await prisma.$transaction(async (tx) => {
        await lockGrade(tx, grade.id);
        const rows = await getAllTermSubjects(tx, {
          schoolId: grade.schoolId,
          gradeLevelId: grade.id,
        });
        if (activeCount(rows) >= MAX_ACTIVE_SUBJECTS_PER_GRADE) {
          throw new AppError("VALIDATION_FAILED", { params: { message: CAP_REACHED } });
        }
        return tx.termSubject.create({
          data: {
            schoolId: grade.schoolId,
            gradeLevelId: grade.id,
            name,
            position: nextPosition(rows),
          },
          select: { id: true },
        });
      });
    } catch (err) {
      if (isNameClash(err)) throw nameTaken(err);
      throw err;
    }

    await writeAudit({
      userId: user.id,
      schoolId: grade.schoolId,
      action: AUDIT_ACTIONS.TERM_SUBJECT_CREATE,
      resource: "TermSubject",
      resourceId: created.id,
      metadata: { gradeLevelId: grade.id, name, actorRole: user.role },
    });
    revalidateTermSubjects();
    return { ok: true, data: { id: created.id } };
  },
  { verb: "add the subject" }
);

export const renameTermSubject = action(
  "renameTermSubject",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireEditor();
    const { id, name } = parseInput(renameTermSubjectSchema, input);
    const subject = await loadSubject(user, id);
    if (subject.deletedAt !== null) throw resourceNotFound("Subject");

    if (subject.name !== name) {
      try {
        const updated = await prisma.termSubject.updateMany({
          where: { id: subject.id, schoolId: subject.schoolId, deletedAt: null },
          data: { name },
        });
        if (updated.count === 0) throw resourceNotFound("Subject");
      } catch (err) {
        if (isNameClash(err)) throw nameTaken(err);
        throw err;
      }
    }

    await writeAudit({
      userId: user.id,
      schoolId: subject.schoolId,
      action: AUDIT_ACTIONS.TERM_SUBJECT_RENAME,
      resource: "TermSubject",
      resourceId: subject.id,
      metadata: {
        termSubjectId: subject.id,
        gradeLevelId: subject.gradeLevelId,
        oldName: subject.name,
        newName: name,
        actorRole: user.role,
      },
    });
    revalidateTermSubjects();
    return { ok: true };
  },
  { verb: "rename the subject" }
);

export const archiveTermSubject = action(
  "archiveTermSubject",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireEditor();
    const { id } = parseInput(termSubjectIdSchema, input);
    const subject = await loadSubject(user, id);
    if (subject.deletedAt !== null) throw resourceNotFound("Subject");

    // TermGrade rows are deliberately untouched: restore brings them back.
    const updated = await prisma.termSubject.updateMany({
      where: { id: subject.id, schoolId: subject.schoolId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (updated.count === 0) throw resourceNotFound("Subject");

    await writeAudit({
      userId: user.id,
      schoolId: subject.schoolId,
      action: AUDIT_ACTIONS.TERM_SUBJECT_ARCHIVE,
      resource: "TermSubject",
      resourceId: subject.id,
      metadata: {
        termSubjectId: subject.id,
        gradeLevelId: subject.gradeLevelId,
        name: subject.name,
        actorRole: user.role,
      },
    });
    revalidateTermSubjects();
    return { ok: true };
  },
  { verb: "remove the subject" }
);

export const restoreTermSubject = action(
  "restoreTermSubject",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireEditor();
    const { id } = parseInput(termSubjectIdSchema, input);
    const subject = await loadSubject(user, id);
    if (subject.deletedAt === null) throw resourceNotFound("Subject");

    try {
      await prisma.$transaction(async (tx) => {
        await lockGrade(tx, subject.gradeLevelId);
        const rows = await getAllTermSubjects(tx, {
          schoolId: subject.schoolId,
          gradeLevelId: subject.gradeLevelId,
        });
        if (activeCount(rows) >= MAX_ACTIVE_SUBJECTS_PER_GRADE) {
          throw new AppError("VALIDATION_FAILED", { params: { message: CAP_REACHED } });
        }
        const updated = await tx.termSubject.updateMany({
          where: { id: subject.id, schoolId: subject.schoolId, deletedAt: { not: null } },
          data: { deletedAt: null, position: nextPosition(rows) },
        });
        if (updated.count === 0) throw resourceNotFound("Subject");
      });
    } catch (err) {
      if (isNameClash(err)) throw nameTaken(err);
      throw err;
    }

    await writeAudit({
      userId: user.id,
      schoolId: subject.schoolId,
      action: AUDIT_ACTIONS.TERM_SUBJECT_RESTORE,
      resource: "TermSubject",
      resourceId: subject.id,
      metadata: {
        termSubjectId: subject.id,
        gradeLevelId: subject.gradeLevelId,
        name: subject.name,
        actorRole: user.role,
      },
    });
    revalidateTermSubjects();
    return { ok: true };
  },
  { verb: "restore the subject" }
);

export const reorderTermSubjects = action(
  "reorderTermSubjects",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireEditor();
    const { gradeLevelId, orderedIds } = parseInput(reorderTermSubjectsSchema, input);
    const grade = await loadGrade(prisma, user, gradeLevelId);

    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "TermSubject"
        WHERE "gradeLevelId" = ${grade.id}
          AND "schoolId" = ${grade.schoolId}
          AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      const plan = planSubjectReorder(
        locked.map((r) => r.id),
        orderedIds
      );
      if (!plan.ok) {
        throw new AppError("VALIDATION_FAILED", { params: { message: LIST_CHANGED } });
      }
      for (const u of plan.updates) {
        await tx.termSubject.updateMany({
          where: { id: u.id, schoolId: grade.schoolId, gradeLevelId: grade.id },
          data: { position: u.position },
        });
      }
    });

    await writeAudit({
      userId: user.id,
      schoolId: grade.schoolId,
      action: AUDIT_ACTIONS.TERM_SUBJECT_REORDER,
      resource: "GradeLevel",
      resourceId: grade.id,
      metadata: { gradeLevelId: grade.id, orderedIds, actorRole: user.role },
    });
    revalidateTermSubjects();
    return { ok: true };
  },
  { verb: "reorder the subjects" }
);

/**
 * School-wide "Reset to default": every live, non-FLOATING grade's End of
 * Terms sheet is brought back to its `GradeLevelType`'s current
 * `TermSubjectDefault` template in one transaction.
 *
 * AUTH/TENANCY: `requireUser("SCHOOL_HEAD")` admits School Heads and Super
 * Admins. A School Head's target school is ALWAYS `user.schoolId` — whatever
 * (if anything) is posted in `schoolId` is ignored for them. Only a Super
 * Admin's posted `schoolId` is honoured, and it is checked to be a live
 * school before anything is read or written.
 */
export const resetSchoolTermSubjects = action(
  "resetSchoolTermSubjects",
  async (
    input: unknown
  ): Promise<{
    ok: true;
    data: { grades: number; created: number; restored: number; archived: number };
  }> => {
    const user = await requireUser("SCHOOL_HEAD");
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const { schoolId: payloadSchoolId } = parseInput(resetSchoolTermSubjectsSchema, input);

    const schoolId = isSuperAdmin ? payloadSchoolId : user.schoolId!;
    if (!schoolId) throw resourceNotFound("School");

    if (isSuperAdmin) {
      const school = await prisma.school.findFirst({
        where: { id: schoolId, deletedAt: null },
        select: { id: true },
      });
      if (!school) throw resourceNotFound("School");
    }

    const data = await prisma.$transaction(async (tx) => {
      const grades = await tx.$queryRaw<{ id: string; type: string }[]>`
        SELECT "id", "type" FROM "GradeLevel"
        WHERE "schoolId" = ${schoolId}
          AND "deletedAt" IS NULL
          AND "type" != 'FLOATING'
        ORDER BY "id"
        FOR UPDATE
      `;

      let created = 0;
      let restored = 0;
      let archived = 0;

      for (const grade of grades) {
        const defaults = await getActiveDefaultsForType(tx, grade.type as GradeLevelType);
        const existing = await getAllTermSubjects(tx, { schoolId, gradeLevelId: grade.id });
        const plan = planSubjectReset(defaults, existing);

        for (const u of plan.toRestore) {
          await tx.termSubject.updateMany({
            where: { id: u.id, schoolId, gradeLevelId: grade.id },
            data: { deletedAt: null, position: u.position },
          });
        }
        for (const u of plan.toReposition) {
          await tx.termSubject.updateMany({
            where: { id: u.id, schoolId, gradeLevelId: grade.id },
            data: { position: u.position },
          });
        }
        if (plan.toCreate.length > 0) {
          await tx.termSubject.createMany({
            data: plan.toCreate.map((c) => ({
              schoolId,
              gradeLevelId: grade.id,
              name: c.name,
              position: c.position,
              legacyArea: null,
            })),
          });
        }
        if (plan.toArchive.length > 0) {
          await tx.termSubject.updateMany({
            where: { id: { in: plan.toArchive }, schoolId, gradeLevelId: grade.id },
            data: { deletedAt: new Date() },
          });
        }

        created += plan.toCreate.length;
        restored += plan.toRestore.length;
        archived += plan.toArchive.length;
      }

      return { grades: grades.length, created, restored, archived };
    }, BULK_TX_OPTIONS);

    await writeAudit({
      userId: user.id,
      schoolId,
      action: AUDIT_ACTIONS.TERM_SUBJECT_RESET_SCHOOL,
      resource: "School",
      resourceId: schoolId,
      metadata: { ...data, actorRole: user.role },
    });
    revalidateTermSubjects();
    return { ok: true, data };
  },
  { verb: "reset the subjects" }
);
