"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { BULK_CHUNK_ROWS, BULK_TX_OPTIONS, chunkRows } from "@/lib/db/bulk-write";
import {
  learnerCsvTemplate,
  mapCsvRowToImportCandidate,
  validateImportRows,
  summarizeImportResults,
  resolveSectionIdByName,
  type ImportRowResult,
} from "@/lib/learners/import-csv";
import {
  isPossibleDuplicate,
  learnerDuplicateKey,
} from "@/lib/learners/normalize";
import {
  learnerImportRowSchema,
  type LearnerImportRow,
} from "@/lib/validators/learner-import.schema";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { teacherAdvisoryGradeScope } from "@/lib/teachers/scope";

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function buildFullName(
  firstName: string,
  middleName: string | undefined,
  lastName: string
): string {
  return [firstName, middleName, lastName].filter(Boolean).join(" ");
}

/**
 * CSV import writes a roster, so this stays adviser-scoped: being some learner's
 * designated ARAL teacher does not grant the right to add learners to a grade.
 */
async function assertTeacherGradeAccess(userId: string, schoolId: string, gradeLevelId: string) {
  return prisma.gradeLevel.findFirst({
    where: {
      id: gradeLevelId,
      schoolId,
      deletedAt: null,
      ...teacherAdvisoryGradeScope(userId),
    },
  });
}

/**
 * Parse import rows and load only matching school learners for dup-check
 * (keyed by name+age) instead of a full-school findMany.
 */
async function loadExistingDuplicateKeys(
  schoolId: string,
  rows: Record<string, unknown>[]
): Promise<Set<string>> {
  const candidates: { firstName: string; lastName: string; age: number }[] = [];
  const seen = new Set<string>();

  for (const raw of rows) {
    const mapped = mapCsvRowToImportCandidate(raw);
    if (!mapped.firstName && !mapped.lastName && (mapped.age === "" || mapped.age == null)) {
      continue;
    }
    const parsed = learnerImportRowSchema.safeParse(mapped);
    if (!parsed.success) continue;
    const key = learnerDuplicateKey(
      parsed.data.firstName,
      parsed.data.lastName,
      parsed.data.age
    );
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      age: parsed.data.age,
    });
  }

  if (candidates.length === 0) return new Set();

  const ages = [...new Set(candidates.map((c) => c.age))];
  // Narrow by age first, then OR only the candidate name triples.
  const matches = await prisma.learner.findMany({
    where: {
      schoolId,
      deletedAt: null,
      age: { in: ages },
      OR: candidates.map((c) => ({
        firstName: { equals: c.firstName, mode: "insensitive" as const },
        lastName: { equals: c.lastName, mode: "insensitive" as const },
        age: c.age,
      })),
    },
    select: { firstName: true, lastName: true, age: true },
  });

  return new Set(
    matches.map((m) => learnerDuplicateKey(m.firstName, m.lastName, m.age))
  );
}

/** Downloadable CSV template string (headers + example row). */
export async function getLearnerImportTemplate(input?: {
  gradeLevelId?: string;
}): Promise<ActionResult<{ csv: string }>> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  let gradeType: string | null = null;
  if (input?.gradeLevelId) {
    const grade = await assertTeacherGradeAccess(
      user.id,
      user.schoolId,
      input.gradeLevelId
    );
    if (!grade) return { ok: false, error: "You are not assigned to this grade level" };
    gradeType = grade.type;
  }

  return { ok: true, data: { csv: learnerCsvTemplate(gradeType) } };
}

/**
 * Preview: validate rows client already mapped (or re-map from raw objects).
 * Does not write. Duplicate detection against school + within file.
 */
export async function previewLearnerImport(input: {
  gradeLevelId: string;
  rows: Record<string, unknown>[];
}): Promise<
  ActionResult<{
    results: ImportRowResult[];
    summary: { valid: number; invalid: number; duplicateWarnings: number };
  }>
> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  const grade = await assertTeacherGradeAccess(user.id, user.schoolId, input.gradeLevelId);
  if (!grade) return { ok: false, error: "You are not assigned to this grade level" };

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: "No rows to preview" };
  }
  if (input.rows.length > 500) {
    return { ok: false, error: "Import limited to 500 rows per file" };
  }

  const [existingKeys, gradeSections] = await Promise.all([
    loadExistingDuplicateKeys(user.schoolId, input.rows),
    prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        gradeLevelId: input.gradeLevelId,
        deletedAt: null,
      },
      select: { name: true },
    }),
  ]);

  const results = validateImportRows(input.rows, {
    existingKeys,
    flagDuplicates: true,
    sectionNames: gradeSections.map((s) => s.name),
  });
  return {
    ok: true,
    data: { results, summary: summarizeImportResults(results) },
  };
}

/**
 * Commit strategy: **valid rows only** (invalid rows skipped + reported).
 * Rows flagged as duplicates are skipped unless `allowDuplicates` is true.
 * No full PII dump in audit — counts only.
 */
export async function commitLearnerImport(input: {
  gradeLevelId: string;
  rows: Record<string, unknown>[];
  allowDuplicates?: boolean;
}): Promise<
  ActionResult<{
    imported: number;
    skippedInvalid: number;
    skippedDuplicate: number;
    results: ImportRowResult[];
  }>
> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  const grade = await assertTeacherGradeAccess(user.id, user.schoolId, input.gradeLevelId);
  if (!grade) return { ok: false, error: "You are not assigned to this grade level" };

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: "No rows to import" };
  }
  if (input.rows.length > 500) {
    return { ok: false, error: "Import limited to 500 rows per file" };
  }

  const [existingKeys, gradeSections] = await Promise.all([
    loadExistingDuplicateKeys(user.schoolId, input.rows),
    prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        gradeLevelId: input.gradeLevelId,
        deletedAt: null,
      },
      select: { id: true, name: true },
    }),
  ]);

  const results = validateImportRows(input.rows, {
    existingKeys,
    flagDuplicates: true,
    sectionNames: gradeSections.map((s) => s.name),
  });
  const toInsert: LearnerImportRow[] = [];
  let skippedDuplicate = 0;

  for (const r of results) {
    if (!r.ok) continue;
    if (r.duplicateWarning && !input.allowDuplicates) {
      skippedDuplicate++;
      continue;
    }
    // Re-check against rows already queued in this batch
    if (
      !input.allowDuplicates &&
      toInsert.some((e) =>
        isPossibleDuplicate(
          { firstName: r.data.firstName, lastName: r.data.lastName, age: r.data.age },
          e
        )
      )
    ) {
      skippedDuplicate++;
      continue;
    }
    toInsert.push(r.data);
  }

  const activeYear = await prisma.schoolYear.findFirst({
    where: { schoolId: user.schoolId, isActive: true },
  });

  // One row per learner, built before the transaction opens so no mapping work
  // happens while a Postgres transaction is held open.
  const learnerRows: Prisma.LearnerCreateManyInput[] = toInsert.map((data) => ({
    schoolId: user.schoolId,
    gradeLevelId: input.gradeLevelId,
    teacherId: user.id,
    // Unknown / blank section names → null; row still imports.
    sectionId: resolveSectionIdByName(data.sectionName, gradeSections).sectionId,
    firstName: data.firstName,
    middleName: data.middleName,
    lastName: data.lastName,
    fullName: buildFullName(data.firstName, data.middleName, data.lastName),
    age: data.age,
    gender: data.gender,
    ethnicity: data.ethnicity ?? null,
    ethnicityOther: data.ethnicity === "OTHER" ? (data.ethnicityOther ?? null) : null,
    englishReadingProfile: data.englishReadingProfile,
    englishFrustrationSubtypes: data.englishFrustrationSubtypes,
    filipinoReadingProfile: data.filipinoReadingProfile,
    filipinoFrustrationSubtypes: data.filipinoFrustrationSubtypes,
    governmentBenefits: data.governmentBenefits,
    parentEducation: data.parentEducation,
    modeOfTransportation: data.modeOfTransportation ?? null,
    distanceHomeToSchool: data.distanceHomeToSchool ?? null,
    previousTransfers: data.previousTransfers ?? null,
    transferDetails:
      data.previousTransfers === "MULTIPLE"
        ? (data.transferDetails?.trim() || null)
        : null,
    isAralLearner: data.isAralLearner ?? false,
    aralEnrolledAt: data.isAralLearner ? new Date() : null,
  }));

  let imported = 0;
  let importedAral = 0;
  if (learnerRows.length > 0) {
    try {
      await prisma.$transaction(
        async (tx) => {
          // Two statements per chunk instead of two per row. At the 500-row cap
          // above that is 10 round trips rather than 1000 — the difference
          // between finishing and dying on the 5 s default with `P2028`.
          for (const chunk of chunkRows(learnerRows, BULK_CHUNK_ROWS)) {
            const created = await tx.learner.createManyAndReturn({
              data: chunk,
              select: {
                id: true,
                gradeLevelId: true,
                sectionId: true,
                isAralLearner: true,
              },
            });

            // Enrollment rows are derived from the RETURNED rows, not zipped
            // against `chunk`, so this does not depend on the order Postgres
            // hands them back.
            if (activeYear) {
              await tx.enrollment.createMany({
                data: created.map((c) => ({
                  learnerId: c.id,
                  schoolId: user.schoolId,
                  schoolYearId: activeYear.id,
                  gradeLevelId: c.gradeLevelId,
                  sectionId: c.sectionId,
                  teacherId: user.id,
                  status: "ACTIVE" as const,
                })),
              });
            }

            imported += created.length;
            importedAral += created.filter((c) => c.isAralLearner).length;
          }
        },
        BULK_TX_OPTIONS
      );
    } catch (err) {
      // The wizard's `handleCommit` has `try { … } finally { … }` and no `catch`,
      // so a thrown `P2028` used to surface as a Next.js server-action error
      // instead of the toast it is written for. Nothing was committed — the
      // whole import is one transaction — so reporting zero is accurate.
      console.error("[commitLearnerImport] transaction failed:", err);
      return {
        ok: false,
        error: "Could not save the import. Please try again with a smaller file.",
      };
    }
  }

  const summary = summarizeImportResults(results);
  const skippedInvalid = summary.invalid;

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.IMPORT_LEARNERS,
    resource: "Learner",
    resourceId: input.gradeLevelId,
    metadata: {
      gradeLevelId: input.gradeLevelId,
      imported,
      skippedInvalid,
      skippedDuplicate,
      rowCount: input.rows.length,
      allowDuplicates: Boolean(input.allowDuplicates),
    },
  });

  revalidatePath(`/teacher/grade/${input.gradeLevelId}`);
  revalidatePath("/teacher/learners");
  if (importedAral > 0) {
    revalidatePath("/teacher/aral");
  }
  revalidateLearnerScoped({
    schoolId: user.schoolId,
    teacherId: user.id,
    adminDashboard: imported > 0,
    teacherShell: importedAral > 0,
  });

  return {
    ok: true,
    data: {
      imported,
      skippedInvalid,
      skippedDuplicate,
      results,
    },
  };
}

/** Re-export mapper for client-side preview before calling preview/commit. */
export async function mapImportRows(
  rows: Record<string, unknown>[]
): Promise<ActionResult<{ mapped: Record<string, unknown>[] }>> {
  await requireSchoolUser("TEACHER");
  return {
    ok: true,
    data: { mapped: rows.map((r) => mapCsvRowToImportCandidate(r)) },
  };
}
