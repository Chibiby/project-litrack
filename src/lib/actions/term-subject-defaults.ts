"use server";

import { Prisma } from "@prisma/client";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { revalidateTermSubjectDefaults } from "@/lib/cache/revalidate";
import {
  MAX_ACTIVE_SUBJECTS_PER_GRADE,
  nextPosition,
  planSubjectReorder,
} from "@/lib/terms/subjects";
import {
  getAllTermSubjectDefaults,
  type TermSubjectDefaultRow,
} from "@/lib/terms/subject-defaults-db";
import {
  createTermSubjectDefaultSchema,
  renameTermSubjectDefaultSchema,
  reorderTermSubjectDefaultsSchema,
  termSubjectDefaultIdSchema,
} from "@/lib/validators/term-subject-default.schema";

/**
 * Super Admin management of the tenant-less per-`GradeLevelType` End of Terms
 * subject templates (`TermSubjectDefault`).
 *
 * AUTH. `requireUser("SUPER_ADMIN")` only — unlike `term-subjects.ts`, there
 * is no School Head path to mirror: this table has no `schoolId` at all.
 * TENANCY. None. Every audit row is written with `schoolId: null`, and
 * editing a template never touches any school's already-seeded `TermSubject`
 * rows (`getAllTermSubjects`'s cold seed and `resetSchoolTermSubjects` are the
 * only two readers, and both read at the moment they run, not on a change
 * feed).
 *
 * `FLOATING` and `KINDER` are both refused before they ever reach here:
 * `gradeLevelType` is validated against `TERM_SHEET_GRADE_TYPES`
 * (`src/lib/validators/term-subject-default.schema.ts`), which excludes
 * both — `FLOATING` has no advisory section, and Kindergarten's report is
 * the fixed competency checklist, not a configurable subject template — so
 * either fails Zod validation, not a runtime check in this file. Existing
 * `TermSubjectDefault` rows with `gradeLevelType: "KINDER"` (seeded before
 * this exclusion) are left in place but unreachable from every action here.
 */

const NAME_TAKEN = "A subject with that name is already in this grade type's template";
const LIST_CHANGED = "The subject list changed. Reload and try again.";
const CAP_REACHED = `A grade type can have at most ${MAX_ACTIVE_SUBJECTS_PER_GRADE} default subjects. Remove one first.`;

async function requireEditor() {
  return requireUser("SUPER_ADMIN");
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

function activeCount(rows: TermSubjectDefaultRow[]): number {
  return rows.filter((r) => r.deletedAt === null).length;
}

/**
 * Serialises one grade type's default edits so the cap and positions stay
 * honest. There is no physical row shared by every default of a type (unlike
 * `GradeLevel` for a school's own subjects), so this locks on the type's hash
 * rather than `SELECT ... FOR UPDATE` on a parent row.
 */
async function lockType(tx: Prisma.TransactionClient, gradeLevelType: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${gradeLevelType}))`;
}

/** A default row (active or archived) by id. */
async function loadDefault(id: string) {
  const row = await prisma.termSubjectDefault.findFirst({
    where: { id },
    select: { id: true, name: true, gradeLevelType: true, deletedAt: true },
  });
  if (!row) throw resourceNotFound("Subject");
  return row;
}

export const createTermSubjectDefault = action(
  "createTermSubjectDefault",
  async (input: unknown): Promise<{ ok: true; data: { id: string } }> => {
    const user = await requireEditor();
    const { gradeLevelType, name } = parseInput(createTermSubjectDefaultSchema, input);

    let created: { id: string };
    try {
      created = await prisma.$transaction(async (tx) => {
        await lockType(tx, gradeLevelType);
        const rows = await getAllTermSubjectDefaults(tx, gradeLevelType);
        if (activeCount(rows) >= MAX_ACTIVE_SUBJECTS_PER_GRADE) {
          throw new AppError("VALIDATION_FAILED", { params: { message: CAP_REACHED } });
        }
        return tx.termSubjectDefault.create({
          data: { gradeLevelType, name, position: nextPosition(rows) },
          select: { id: true },
        });
      });
    } catch (err) {
      if (isNameClash(err)) throw nameTaken(err);
      throw err;
    }

    await writeAudit({
      userId: user.id,
      schoolId: null,
      action: AUDIT_ACTIONS.TERM_SUBJECT_DEFAULT_CREATE,
      resource: "TermSubjectDefault",
      resourceId: created.id,
      metadata: { gradeLevelType, name },
    });
    revalidateTermSubjectDefaults();
    return { ok: true, data: { id: created.id } };
  },
  { verb: "add the default subject" }
);

export const renameTermSubjectDefault = action(
  "renameTermSubjectDefault",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireEditor();
    const { id, name } = parseInput(renameTermSubjectDefaultSchema, input);
    const row = await loadDefault(id);
    if (row.deletedAt !== null) throw resourceNotFound("Subject");

    if (row.name !== name) {
      try {
        const updated = await prisma.termSubjectDefault.updateMany({
          where: { id: row.id, deletedAt: null },
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
      schoolId: null,
      action: AUDIT_ACTIONS.TERM_SUBJECT_DEFAULT_RENAME,
      resource: "TermSubjectDefault",
      resourceId: row.id,
      metadata: {
        gradeLevelType: row.gradeLevelType,
        oldName: row.name,
        newName: name,
      },
    });
    revalidateTermSubjectDefaults();
    return { ok: true };
  },
  { verb: "rename the default subject" }
);

export const archiveTermSubjectDefault = action(
  "archiveTermSubjectDefault",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireEditor();
    const { id } = parseInput(termSubjectDefaultIdSchema, input);
    const row = await loadDefault(id);
    if (row.deletedAt !== null) throw resourceNotFound("Subject");

    const updated = await prisma.termSubjectDefault.updateMany({
      where: { id: row.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (updated.count === 0) throw resourceNotFound("Subject");

    await writeAudit({
      userId: user.id,
      schoolId: null,
      action: AUDIT_ACTIONS.TERM_SUBJECT_DEFAULT_ARCHIVE,
      resource: "TermSubjectDefault",
      resourceId: row.id,
      metadata: { gradeLevelType: row.gradeLevelType, name: row.name },
    });
    revalidateTermSubjectDefaults();
    return { ok: true };
  },
  { verb: "remove the default subject" }
);

export const restoreTermSubjectDefault = action(
  "restoreTermSubjectDefault",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireEditor();
    const { id } = parseInput(termSubjectDefaultIdSchema, input);
    const row = await loadDefault(id);
    if (row.deletedAt === null) throw resourceNotFound("Subject");

    try {
      await prisma.$transaction(async (tx) => {
        await lockType(tx, row.gradeLevelType);
        const rows = await getAllTermSubjectDefaults(tx, row.gradeLevelType);
        if (activeCount(rows) >= MAX_ACTIVE_SUBJECTS_PER_GRADE) {
          throw new AppError("VALIDATION_FAILED", { params: { message: CAP_REACHED } });
        }
        const updated = await tx.termSubjectDefault.updateMany({
          where: { id: row.id, deletedAt: { not: null } },
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
      schoolId: null,
      action: AUDIT_ACTIONS.TERM_SUBJECT_DEFAULT_RESTORE,
      resource: "TermSubjectDefault",
      resourceId: row.id,
      metadata: { gradeLevelType: row.gradeLevelType, name: row.name },
    });
    revalidateTermSubjectDefaults();
    return { ok: true };
  },
  { verb: "restore the default subject" }
);

export const reorderTermSubjectDefaults = action(
  "reorderTermSubjectDefaults",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireEditor();
    const { gradeLevelType, orderedIds } = parseInput(
      reorderTermSubjectDefaultsSchema,
      input
    );

    await prisma.$transaction(async (tx) => {
      await lockType(tx, gradeLevelType);
      const rows = await tx.termSubjectDefault.findMany({
        where: { gradeLevelType, deletedAt: null },
        select: { id: true },
      });
      const plan = planSubjectReorder(rows.map((r) => r.id), orderedIds);
      if (!plan.ok) {
        throw new AppError("VALIDATION_FAILED", { params: { message: LIST_CHANGED } });
      }
      for (const u of plan.updates) {
        await tx.termSubjectDefault.updateMany({
          where: { id: u.id, gradeLevelType },
          data: { position: u.position },
        });
      }
    });

    await writeAudit({
      userId: user.id,
      schoolId: null,
      action: AUDIT_ACTIONS.TERM_SUBJECT_DEFAULT_REORDER,
      resource: "TermSubjectDefault",
      resourceId: null,
      metadata: { gradeLevelType, orderedIds },
    });
    revalidateTermSubjectDefaults();
    return { ok: true };
  },
  { verb: "reorder the default subjects" }
);
