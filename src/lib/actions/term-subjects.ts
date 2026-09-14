"use server";

import { Prisma, type User } from "@prisma/client";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { requireUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { revalidateTermSubjects } from "@/lib/cache/revalidate";
import {
  MAX_ACTIVE_SUBJECTS_PER_GRADE,
  nextPosition,
  planSubjectReorder,
} from "@/lib/terms/subjects";
import {
  getAllTermSubjects,
  getManagedTermSubjects,
  type TermSubjectRow,
} from "@/lib/terms/subjects-db";
import {
  createTermSubjectSchema,
  renameTermSubjectSchema,
  reorderTermSubjectsSchema,
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
const FLOATING_GRADE = "Floating has no End of Terms sheet, so it has no subjects.";

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
    throw new AppError("VALIDATION_FAILED", { params: { message: FLOATING_GRADE } });
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
    throw new AppError("VALIDATION_FAILED", { params: { message: FLOATING_GRADE } });
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
