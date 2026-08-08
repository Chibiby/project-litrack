"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  learnerCsvTemplate,
  mapCsvRowToImportCandidate,
  validateImportRows,
  summarizeImportResults,
  resolveSectionIdByName,
  type ImportRowResult,
} from "@/lib/learners/import-csv";
import { isPossibleDuplicate } from "@/lib/learners/normalize";
import type { LearnerImportRow } from "@/lib/validators/learner-import.schema";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";

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

async function assertTeacherGradeAccess(userId: string, schoolId: string, gradeLevelId: string) {
  return prisma.gradeLevel.findFirst({
    where: {
      id: gradeLevelId,
      schoolId,
      deletedAt: null,
      teachers: { some: { id: userId } },
    },
  });
}

/** Downloadable CSV template string (headers + example row). */
export async function getLearnerImportTemplate(): Promise<ActionResult<{ csv: string }>> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };
  return { ok: true, data: { csv: learnerCsvTemplate() } };
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

  const [existing, gradeSections] = await Promise.all([
    prisma.learner.findMany({
      where: { schoolId: user.schoolId, deletedAt: null },
      select: { firstName: true, lastName: true, age: true },
    }),
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
    existing,
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

  const [existing, gradeSections] = await Promise.all([
    prisma.learner.findMany({
      where: { schoolId: user.schoolId, deletedAt: null },
      select: { firstName: true, lastName: true, age: true },
    }),
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
    existing,
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

  let imported = 0;
  if (toInsert.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const data of toInsert) {
        const fullName = buildFullName(data.firstName, data.middleName, data.lastName);
        // Unknown / blank section names → null; row still imports.
        const { sectionId } = resolveSectionIdByName(data.sectionName, gradeSections);
        const created = await tx.learner.create({
          data: {
            schoolId: user.schoolId,
            gradeLevelId: input.gradeLevelId,
            teacherId: user.id,
            sectionId,
            firstName: data.firstName,
            middleName: data.middleName,
            lastName: data.lastName,
            fullName,
            age: data.age,
            gender: data.gender,
            englishReadingProfile: data.englishReadingProfile,
            englishFrustrationSubtypes: data.englishFrustrationSubtypes,
            filipinoReadingProfile: data.filipinoReadingProfile,
            filipinoFrustrationSubtypes: data.filipinoFrustrationSubtypes,
            governmentBenefits: data.governmentBenefits,
            parentEducation: data.parentEducation,
            isAralLearner: data.isAralLearner ?? false,
            aralEnrolledAt: data.isAralLearner ? new Date() : null,
          },
        });

        if (activeYear) {
          await tx.enrollment.create({
            data: {
              learnerId: created.id,
              schoolId: user.schoolId,
              schoolYearId: activeYear.id,
              gradeLevelId: created.gradeLevelId,
              sectionId: created.sectionId,
              teacherId: user.id,
              status: "ACTIVE",
            },
          });
        }
        imported++;
      }
    });
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
  revalidatePath("/teacher");
  revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });

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
