"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  readingLevelSchema,
  readingLevelMonthlyBulkSchema,
} from "@/lib/validators/reading-level.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { BULK_CHUNK_ROWS, BULK_TX_OPTIONS, chunkRows } from "@/lib/db/bulk-write";
import { revalidateLearnerScoped, revalidateTeacherDashboard } from "@/lib/cache/revalidate";
import {
  aralLearnerScope,
  teacherIsAralTutorFor,
} from "@/lib/teachers/scope";
import {
  formatMonthDeadlineLongDate,
  formatMonthKey,
  nextMonthStart,
} from "@/lib/month-range";
import { resolveMonthlyReadingLevelWindow } from "@/lib/unlock/reading-level-window";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * One `ReadingLevelRecord` row, already deduped on its conflict tuple. The
 * monthly bulk save may carry a partially-filled row, so every value field is
 * nullable here — `englishProfile` / `filipinoProfile` are `ReadingProfile?`
 * in the schema precisely so this can bind `null`.
 */
type RawReadingLevelRow = {
  id: string;
  learnerId: string;
  englishProfile: string | null;
  filipinoProfile: string | null;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
  writingLevel: string | null;
  notes: string | null;
};

export async function recordReadingLevel(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = readingLevelSchema.safeParse({
    learnerId: formData.get("learnerId"),
    weekStart: formData.get("weekStart"),
    englishProfile: formData.get("englishProfile"),
    filipinoProfile: formData.get("filipinoProfile"),
    wordRecognitionLevel: formData.get("wordRecognitionLevel"),
    readingComprehensionLevel: formData.get("readingComprehensionLevel"),
    writingLevel: formData.get("writingLevel"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  // A Monday-keyed legacy write is still ABOUT that month and must obey the
  // same lock the monthly grid does — same helper, same precedence, so the
  // banner a teacher reads and the rule enforced here can never drift apart.
  const monthKey = formatMonthKey(parsed.data.weekStart);
  const window = await resolveMonthlyReadingLevelWindow({
    userId: user.id,
    schoolId: user.schoolId,
    monthKey,
    today: schoolToday(),
  });
  if (!window.writable) {
    return {
      ok: false,
      error: `This month is locked. Editing closed on ${formatMonthDeadlineLongDate(monthKey)}.`,
    };
  }

  const learner = await prisma.learner.findFirst({
    where: { id: parsed.data.learnerId, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  try {
    assertSameSchool(user.schoolId, learner.schoolId);
  } catch {
    return { ok: false, error: "Not found" };
  }
  // The designated ARAL tutor, not merely the adviser — same rule as the bulk
  // path below and as `markAttendance`.
  if (!teacherIsAralTutorFor(learner, user.id)) {
    return { ok: false, error: "Not found" };
  }
  if (!learner.isAralLearner) {
    return { ok: false, error: "Reading-level tracking is only for ARAL learners" };
  }

  const weekStart = parsed.data.weekStart;

  await prisma.readingLevelRecord.upsert({
    where: {
      learnerId_weekStart: {
        learnerId: learner.id,
        weekStart,
      },
    },
    create: {
      learnerId: learner.id,
      weekStart,
      englishProfile: parsed.data.englishProfile,
      filipinoProfile: parsed.data.filipinoProfile,
      wordRecognitionLevel: parsed.data.wordRecognitionLevel,
      readingComprehensionLevel: parsed.data.readingComprehensionLevel,
      writingLevel: parsed.data.writingLevel ?? null,
      notes: parsed.data.notes,
      recordedById: user.id,
    },
    update: {
      englishProfile: parsed.data.englishProfile,
      filipinoProfile: parsed.data.filipinoProfile,
      wordRecognitionLevel: parsed.data.wordRecognitionLevel,
      readingComprehensionLevel: parsed.data.readingComprehensionLevel,
      writingLevel: parsed.data.writingLevel ?? null,
      notes: parsed.data.notes,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.READING_LEVEL_RECORD,
    resource: "ReadingLevelRecord",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      weekStart: weekStart.toISOString().slice(0, 10),
    },
  });

  revalidatePath("/teacher/aral");
  revalidatePath(
    `/teacher/aral/${learner.gradeLevelId}/learners/${learner.id}/reading-level`
  );
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}/reading-level`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    aralTeacherId: learner.aralTeacherId,
  });
  return { ok: true };
}

/**
 * Upsert one month's reading levels for many ARAL learners.
 * Input: `{ monthStart, entries: [{ learnerId, englishProfile, filipinoProfile, wordRecognitionLevel, readingComprehensionLevel, writingLevel?, notes? }] }`
 * `monthStart` is coerced and normalized to the 1st of the month.
 *
 * The stored column is still `weekStart`. The ARAL reading level is assessed
 * monthly — the nav, the teacher dashboard task, and every dashboard aggregate
 * already treat it that way — so the row is keyed to the 1st of the month rather
 * than a Monday. That reuses the existing `@@unique([learnerId, weekStart])`,
 * which then reads as "one assessment per learner per month", and needs no
 * migration. Rows written by the earlier weekly grid stay exactly where they
 * are; `fetchAralReadingLevelForMonth` reads the whole month, so they still
 * prefill the grid and saving consolidates them onto the anchor.
 */
export async function bulkRecordMonthlyReadingLevel(
  input: unknown
): Promise<ActionResult<{ upserted: number; cleared: number }>> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = readingLevelMonthlyBulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const monthStart = parsed.data.monthStart;
  const monthKey = formatLocalDateKey(monthStart);

  // Deadline gate FIRST, before any learner query — a past-deadline save with
  // no grant must be refused without ever touching the roster. `canWriteWindow`
  // is consulted only when the date itself says the window is closed.
  const window = await resolveMonthlyReadingLevelWindow({
    userId: user.id,
    schoolId: user.schoolId,
    monthKey,
    today: schoolToday(),
  });
  if (!window.writable) {
    return {
      ok: false,
      error: `This month is locked. Editing closed on ${formatMonthDeadlineLongDate(monthKey)}.`,
    };
  }
  const usedGrantId = window.grantId;
  const usedGrantKind = window.grantKind;

  const entryIds = parsed.data.entries.map((e) => e.learnerId);
  const clearIds = parsed.data.clears;
  const learnerIds = [...new Set([...entryIds, ...clearIds])];

  const learners = await prisma.learner.findMany({
    where: {
      id: { in: learnerIds },
      schoolId: user.schoolId,
      // The designated tutor only — see `saveAralWeeklyAttendance`. Reading
      // levels are the ARAL programme's own record of a learner's progress.
      ...aralLearnerScope(user.id),
      deletedAt: null,
      isAralLearner: true,
    },
    select: { id: true, gradeLevelId: true, teacherId: true, aralTeacherId: true },
  });

  if (learners.length !== learnerIds.length) {
    return {
      ok: false,
      error: "One or more learners were not found or are not ARAL learners",
    };
  }

  const byId = new Map(learners.map((l) => [l.id, l]));

  // Dedupe on the conflict tuple BEFORE the statement is built. The old array
  // form ran one `upsert` per entry serially, so a duplicated learner was a
  // harmless last-write-wins; a single multi-row `ON CONFLICT DO UPDATE` raises
  // Postgres 21000 ("cannot affect row a second time") and aborts the whole save.
  // `weekStart` is the same `monthStart` for every row here, so it is keyed in
  // explicitly rather than assumed — the tuple is ([learnerId, weekStart]), and
  // this dedupes on the value about to be written, not on a variable name.
  const rowByTuple = new Map<string, RawReadingLevelRow>();
  for (const entry of parsed.data.entries) {
    rowByTuple.set(`${entry.learnerId}:${monthKey}`, {
      id: randomUUID(),
      learnerId: entry.learnerId,
      // A partial row is the normal state on this grid: any field the teacher
      // has not filled in yet is written as NULL rather than left alone, since
      // this is an INSERT ... ON CONFLICT and there is no prior row value to
      // preserve for a field the client omitted.
      englishProfile: entry.englishProfile ?? null,
      filipinoProfile: entry.filipinoProfile ?? null,
      wordRecognitionLevel: entry.wordRecognitionLevel ?? null,
      readingComprehensionLevel: entry.readingComprehensionLevel ?? null,
      writingLevel: entry.writingLevel ?? null,
      notes: entry.notes ?? null,
    });
  }
  const rows = [...rowByTuple.values()];

  const nextMonth = nextMonthStart(monthStart);
  const now = new Date();
  let cleared = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Upserts. Skipped entirely when the save is clears-only.
      for (const chunk of chunkRows(rows, BULK_CHUNK_ROWS)) {
        // `id` and `updatedAt` are supplied explicitly: Prisma's `@default(uuid())`
        // and `@updatedAt` are CLIENT-side, and neither column has a database
        // default. `updatedAt` is bumped in DO UPDATE too — omitting it there
        // would freeze the column at first-insert time silently, with no error.
        //
        // `weekStart` binds the YYYY-MM-DD TEXT from `formatLocalDateKey` and
        // casts in SQL. Binding the `Date` would re-serialize local midnight as a
        // UTC instant, which agrees with the intended day on Vercel (TZ=UTC) and
        // disagrees on a UTC+8 developer machine.
        //
        // Enums bind `::text::"Enum"`, never a bare `::"Enum"` — see the long
        // comment in `attendance.ts` explaining the double cast. It applies here
        // too, and now doubly matters: `englishProfile` / `filipinoProfile` may
        // be a bound `null`, and the cast still has to resolve to the nullable
        // `ReadingProfile` column type rather than an untyped parameter.
        const values = Prisma.join(
          chunk.map(
            (r) => Prisma.sql`(
              ${r.id}::text,
              ${r.learnerId}::text,
              ${monthKey}::date,
              ${r.englishProfile}::text::"ReadingProfile",
              ${r.filipinoProfile}::text::"ReadingProfile",
              ${r.wordRecognitionLevel}::text::"WeeklyWordRecognitionLevel",
              ${r.readingComprehensionLevel}::text::"WeeklyReadingComprehensionLevel",
              ${r.writingLevel}::text::"WeeklyWritingLevel",
              ${r.notes}::text,
              ${user.id}::text,
              ${now}::timestamp(3)
            )`
          )
        );

        // The tenant predicate lives IN the statement. The scoped `findMany` above
        // already fails the whole batch on any foreign id, so this join can only
        // match every row — but `ReadingLevelRecord` carries no `schoolId` of its
        // own, and a raw INSERT with no tenant predicate would be one deleted
        // guard away from writing across schools. The row count is checked below,
        // so a predicate that ever excluded a row rolls the transaction back
        // rather than committing a partial save.
        const written = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "ReadingLevelRecord" (
            "id", "learnerId", "weekStart", "englishProfile", "filipinoProfile",
            "wordRecognitionLevel", "readingComprehensionLevel", "writingLevel",
            "notes", "recordedById", "updatedAt"
          )
          SELECT v."id", v."learnerId", v."weekStart", v."englishProfile",
                 v."filipinoProfile", v."wordRecognitionLevel",
                 v."readingComprehensionLevel", v."writingLevel", v."notes",
                 v."recordedById", v."updatedAt"
          FROM (VALUES ${values}) AS v (
            "id", "learnerId", "weekStart", "englishProfile", "filipinoProfile",
            "wordRecognitionLevel", "readingComprehensionLevel", "writingLevel",
            "notes", "recordedById", "updatedAt"
          )
          JOIN "Learner" l
            ON l."id" = v."learnerId"
           AND l."schoolId" = ${user.schoolId}
           AND l."deletedAt" IS NULL
           AND l."isAralLearner" = TRUE
          ON CONFLICT ("learnerId", "weekStart") DO UPDATE SET
            "englishProfile" = EXCLUDED."englishProfile",
            "filipinoProfile" = EXCLUDED."filipinoProfile",
            "wordRecognitionLevel" = EXCLUDED."wordRecognitionLevel",
            "readingComprehensionLevel" = EXCLUDED."readingComprehensionLevel",
            "writingLevel" = EXCLUDED."writingLevel",
            "notes" = EXCLUDED."notes",
            "recordedById" = EXCLUDED."recordedById",
            "updatedAt" = EXCLUDED."updatedAt"
          RETURNING "id"
        `;
        if (written.length !== chunk.length) {
          throw new Error(
            `reading-level bulk write touched ${written.length} of ${chunk.length} rows`
          );
        }
      }

      // 2. Clears, AFTER the upserts — same ordering rule as
      //    `saveAralWeeklyAttendance`. Deleted by MONTH RANGE, not by the
      //    anchor: `fetchAralReadingLevelForMonth` reads the whole month
      //    because legacy rows sit on arbitrary Mondays, so deleting only the
      //    anchor would let an old row reappear on the next render and the
      //    teacher would see the clear silently undo itself. `cleared` is the
      //    returned row count, never the submitted id count — clearing an
      //    already-empty month is not an error.
      for (const chunk of chunkRows(clearIds, BULK_CHUNK_ROWS)) {
        const values = Prisma.join(chunk.map((id) => Prisma.sql`(${id}::text)`));
        const deleted = await tx.$queryRaw<{ id: string }[]>`
          DELETE FROM "ReadingLevelRecord" r
          USING (VALUES ${values}) AS v ("learnerId"),
                "Learner" l
          WHERE r."learnerId" = v."learnerId"
            AND r."weekStart" >= ${monthKey}::date
            AND r."weekStart" < ${formatLocalDateKey(nextMonth)}::date
            AND l."id" = r."learnerId"
            AND l."schoolId" = ${user.schoolId}
            AND l."deletedAt" IS NULL
            AND l."isAralLearner" = TRUE
          RETURNING r."id"
        `;
        cleared += deleted.length;
      }
    }, BULK_TX_OPTIONS);
  } catch (err) {
    console.error("[bulkRecordMonthlyReadingLevel] transaction failed:", err);
    return { ok: false, error: "Could not save the reading levels. Please try again." };
  }

  const upserted = rows.length;
  const gradeIds = [...new Set(learners.map((l) => l.gradeLevelId))];
  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.READING_LEVEL_BULK_RECORD,
    resource: "ReadingLevelRecord",
    resourceId: gradeIds[0] ?? null,
    metadata: {
      schoolId: user.schoolId,
      monthStart: monthKey,
      upserted,
      cleared,
      learnerIds,
      gradeLevelIds: gradeIds,
      grantKind: usedGrantKind,
    },
  });

  // A second row, only when the save got in through a grant. Kept separate
  // from the save row so "which edits happened inside a reopened window" is
  // one action to filter on, mirroring `saveAralWeeklyAttendance`.
  //
  // Which action and resource depends on WHICH table the grant came from — a
  // school-wide grant is a `SchoolUnlockGrant` row, and joining its id against
  // `UnlockGrant` finds nothing. `grantKind` also rides in `metadata` so the
  // save row and this row agree on which table answered "may this person write".
  if (usedGrantId) {
    const isSchoolGrant = usedGrantKind === "school";
    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: isSchoolGrant
        ? AUDIT_ACTIONS.UNLOCK_SCHOOL_GRANT_USED
        : AUDIT_ACTIONS.UNLOCK_GRANT_USED,
      resource: isSchoolGrant ? "SchoolUnlockGrant" : "UnlockGrant",
      resourceId: usedGrantId,
      metadata: {
        scope: "MONTHLY_READING_LEVEL",
        targetKey: monthKey,
        gradeLevelIds: gradeIds,
        upserted,
        cleared,
        grantKind: usedGrantKind,
      },
    });
  }

  for (const gradeId of gradeIds) {
    revalidatePath(`/teacher/aral/${gradeId}/reading-level`);
  }
  revalidatePath("/teacher/aral");
  for (const id of learnerIds) {
    const l = byId.get(id);
    if (!l) continue;
    revalidatePath(`/teacher/aral/${l.gradeLevelId}/learners/${id}/reading-level`);
    revalidatePath(`/teacher/grade/${l.gradeLevelId}/learners/${id}`);
  }
  revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });
  // The acting teacher may be the ARAL teacher while somebody else advises the
  // learner (or vice versa) — bust every affected teacher's metrics.
  for (const l of learners) {
    for (const id of [l.teacherId, l.aralTeacherId]) {
      if (id && id !== user.id) revalidateTeacherDashboard(id);
    }
  }

  return { ok: true, data: { upserted, cleared } };
}
