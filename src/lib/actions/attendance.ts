"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  attendanceMarkSchema,
  attendanceWeekSchema,
} from "@/lib/validators/attendance.schema";
import { getMonday } from "@/lib/utils";
import {
  addDays,
  formatLocalDateKey,
  parseLocalDateKey,
  schoolToday,
} from "@/lib/date-keys";
import { attendanceDeadline, formatLongDate } from "@/lib/week-range";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { BULK_CHUNK_ROWS, BULK_TX_OPTIONS, chunkRows } from "@/lib/db/bulk-write";
import { revalidateLearnerScoped, revalidateTeacherDashboard } from "@/lib/cache/revalidate";
import {
  teacherCanAccessLearner,
  teacherGradeScope,
  teacherLearnerScope,
} from "@/lib/teachers/scope";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

function normalizeDate(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function markAttendance(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = attendanceMarkSchema.safeParse({
    learnerId: formData.get("learnerId"),
    date: formData.get("date"),
    status: formData.get("status"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
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
  if (!teacherCanAccessLearner(learner, user.id)) {
    return { ok: false, error: "Not found" };
  }
  if (!learner.isAralLearner) {
    return { ok: false, error: "Attendance tracking is only for ARAL learners" };
  }

  const date = normalizeDate(parsed.data.date);
  const weekStart = getMonday(date);

  await prisma.attendance.upsert({
    where: { learnerId_date: { learnerId: learner.id, date } },
    create: {
      learnerId: learner.id,
      date,
      weekStart,
      status: parsed.data.status,
      notes: parsed.data.notes,
      recordedById: user.id,
    },
    update: {
      status: parsed.data.status,
      notes: parsed.data.notes,
      recordedById: user.id,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ATTENDANCE_MARK,
    resource: "Attendance",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      date: parsed.data.date,
      status: parsed.data.status,
    },
  });

  revalidatePath("/teacher/aral");
  revalidatePath(
    `/teacher/aral/${learner.gradeLevelId}/learners/${learner.id}/attendance`
  );
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}/attendance`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    aralTeacherId: learner.aralTeacherId,
  });
  return { ok: true };
}

/**
 * Save one week of ARAL attendance for a grade, from the weekly grid.
 *
 * Only the cells and remarks the teacher actually changed arrive here, so an
 * untouched cell is never rewritten — that is what keeps a legacy `LATE` row
 * alive through a save that never touched it.
 */
export async function saveAralWeeklyAttendance(input: unknown): Promise<
  ActionResult<{
    upserted: number;
    cleared: number;
    remarksApplied: number;
    /** Remarks with nowhere to live: the learner has no marked day that week. */
    remarksSkipped: number;
  }>
> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = attendanceWeekSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const weekStart = getMonday(parseLocalDateKey(parsed.data.weekStart));
  if (formatLocalDateKey(weekStart) !== parsed.data.weekStart) {
    return { ok: false, error: "Week must start on a Monday" };
  }
  const nextWeekStart = addDays(weekStart, 7);

  // The rule the grid's banner states, enforced here rather than trusted from
  // the client. Both read the same helper so the date a teacher is shown is the
  // date that actually closes the week.
  const deadline = attendanceDeadline(weekStart);
  if (schoolToday() > deadline) {
    return {
      ok: false,
      error: `This week is locked. Editing closed on ${formatLongDate(deadline)}.`,
    };
  }

  // ARAL attendance: an ARAL-only teacher (no advisory section) reaches this
  // grade through the learners designated to them.
  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeId,
      deletedAt: null,
      schoolId: user.schoolId,
      ...teacherGradeScope(user.id),
    },
    select: { id: true },
  });
  if (!grade) return { ok: false, error: "Grade not found" };

  const holidays = await prisma.attendanceDayMeta.findMany({
    where: {
      gradeLevelId: grade.id,
      date: { gte: weekStart, lt: nextWeekStart },
      isHoliday: true,
    },
    select: { date: true },
  });
  const holidayKeys = new Set(holidays.map((h) => formatLocalDateKey(h.date)));

  // Days that cannot carry a mark are dropped silently rather than rejected: a
  // grid left open across a holiday toggle legitimately holds stale cells, and
  // failing the whole save would throw away the teacher's other edits.
  type Cell = {
    learnerId: string;
    date: Date;
    status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | null;
  };
  const cellByKey = new Map<string, Cell>();
  for (const cell of parsed.data.cells) {
    const date = parseLocalDateKey(cell.date);
    if (date < weekStart || date >= nextWeekStart) continue;
    const day = date.getDay();
    if (day === 0 || day === 6) continue; // Sat/Sun are never school days
    if (holidayKeys.has(cell.date)) continue;
    // Last one wins, should a client ever send the same cell twice.
    cellByKey.set(`${cell.learnerId}:${cell.date}`, {
      learnerId: cell.learnerId,
      date,
      status: cell.status,
    });
  }
  const cells = [...cellByKey.values()];

  if (cells.length === 0 && parsed.data.remarks.length === 0) {
    return { ok: false, error: "Nothing to save" };
  }

  const learnerIds = [
    ...new Set([
      ...cells.map((c) => c.learnerId),
      ...parsed.data.remarks.map((r) => r.learnerId),
    ]),
  ];

  const learners = await prisma.learner.findMany({
    where: {
      id: { in: learnerIds },
      schoolId: user.schoolId,
      gradeLevelId: grade.id,
      ...teacherLearnerScope(user.id),
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

  // Three set-based statements, still ordered. The order is load-bearing: a
  // weekly remark is an UPDATE over rows the insert creates, so it has to run
  // last or a first-time entry would lose its remark. Clears sit between them,
  // exactly as the per-row version had them, so a cell cleared in the same save
  // is not resurrected by the remark pass.
  const weekKey = formatLocalDateKey(weekStart);
  const marks = cells.filter(
    (c): c is Cell & { status: NonNullable<Cell["status"]> } => c.status !== null
  );
  const clears = cells.filter((c) => c.status === null);

  // Remarks are keyed on the learner's whole week, so two remarks for one learner
  // would make `UPDATE … FROM (VALUES …)` pick a source row arbitrarily. Dedupe
  // last-wins, matching how `cellByKey` above already treats repeated cells.
  const remarkByLearner = new Map<string, { learnerId: string; notes: string | null }>();
  for (const remark of parsed.data.remarks) {
    remarkByLearner.set(remark.learnerId, {
      learnerId: remark.learnerId,
      notes: remark.notes.length > 0 ? remark.notes : null,
    });
  }
  const remarks = [...remarkByLearner.values()];

  const now = new Date();
  let upserted = 0;
  let cleared = 0;
  const remarkedLearnerIds = new Set<string>();

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Marks. `id` and `updatedAt` are supplied explicitly because Prisma's
      //    `@default(uuid())` and `@updatedAt` are CLIENT-side and neither column
      //    has a database default; `updatedAt` is bumped in DO UPDATE too, or the
      //    column would freeze at first-insert time with nothing to fail.
      //    `notes` is deliberately absent from both branches — remarks are weekly
      //    and are applied in step 3 across the learner's whole week.
      //    Dates bind as YYYY-MM-DD TEXT and cast in SQL: `Attendance.date` and
      //    `.weekStart` are `@db.Date`, and binding a local-midnight `Date` would
      //    write the intended day on Vercel (TZ=UTC) and the previous one on a
      //    UTC+8 developer machine.
      for (const chunk of chunkRows(marks, BULK_CHUNK_ROWS)) {
        const values = Prisma.join(
          chunk.map(
            (c) => Prisma.sql`(
              ${randomUUID()}::text,
              ${c.learnerId}::text,
              ${formatLocalDateKey(c.date)}::date,
              ${weekKey}::date,
              ${c.status}::"AttendanceStatus",
              ${user.id}::text,
              ${now}::timestamp(3)
            )`
          )
        );
        const written = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "Attendance" (
            "id", "learnerId", "date", "weekStart", "status", "recordedById",
            "updatedAt"
          )
          SELECT v."id", v."learnerId", v."date", v."weekStart", v."status",
                 v."recordedById", v."updatedAt"
          FROM (VALUES ${values}) AS v (
            "id", "learnerId", "date", "weekStart", "status", "recordedById",
            "updatedAt"
          )
          JOIN "Learner" l
            ON l."id" = v."learnerId"
           AND l."schoolId" = ${user.schoolId}
           AND l."gradeLevelId" = ${grade.id}
           AND l."deletedAt" IS NULL
           AND l."isAralLearner" = TRUE
          ON CONFLICT ("learnerId", "date") DO UPDATE SET
            "status" = EXCLUDED."status",
            "recordedById" = EXCLUDED."recordedById",
            "updatedAt" = EXCLUDED."updatedAt"
          RETURNING "id"
        `;
        if (written.length !== chunk.length) {
          throw new Error(
            `attendance bulk write touched ${written.length} of ${chunk.length} rows`
          );
        }
        upserted += written.length;
      }

      // 2. Clears. `cleared` was a SUM of per-statement counts, so it is the
      //    number of rows actually deleted — not the number of cells submitted,
      //    which differ whenever a teacher clears an already-empty cell.
      for (const chunk of chunkRows(clears, BULK_CHUNK_ROWS)) {
        const values = Prisma.join(
          chunk.map(
            (c) => Prisma.sql`(
              ${c.learnerId}::text,
              ${formatLocalDateKey(c.date)}::date
            )`
          )
        );
        const deleted = await tx.$queryRaw<{ id: string }[]>`
          DELETE FROM "Attendance" a
          USING (VALUES ${values}) AS v ("learnerId", "date"),
                "Learner" l
          WHERE a."learnerId" = v."learnerId"
            AND a."date" = v."date"
            AND l."id" = a."learnerId"
            AND l."schoolId" = ${user.schoolId}
            AND l."gradeLevelId" = ${grade.id}
            AND l."deletedAt" IS NULL
          RETURNING a."id"
        `;
        cleared += deleted.length;
      }

      // 3. Remarks. `remarksApplied` was a COUNT OF STATEMENTS whose count > 0,
      //    which is a different reduction from `cleared` above: a remark applies
      //    once per learner however many days it touched. `RETURNING "learnerId"`
      //    gives one row per updated day, so the DISTINCT learner ids reproduce
      //    the old number exactly, and `remarksSkipped` is the submitted remarks
      //    minus those.
      for (const chunk of chunkRows(remarks, BULK_CHUNK_ROWS)) {
        const values = Prisma.join(
          chunk.map(
            (r) => Prisma.sql`(
              ${r.learnerId}::text,
              ${r.notes}::text
            )`
          )
        );
        const touched = await tx.$queryRaw<{ learnerId: string }[]>`
          UPDATE "Attendance" a
          SET "notes" = v."notes",
              "updatedAt" = ${now}::timestamp(3)
          FROM (VALUES ${values}) AS v ("learnerId", "notes"),
               "Learner" l
          WHERE a."learnerId" = v."learnerId"
            AND a."weekStart" = ${weekKey}::date
            AND l."id" = a."learnerId"
            AND l."schoolId" = ${user.schoolId}
            AND l."gradeLevelId" = ${grade.id}
            AND l."deletedAt" IS NULL
          RETURNING a."learnerId"
        `;
        for (const row of touched) remarkedLearnerIds.add(row.learnerId);
      }
    }, BULK_TX_OPTIONS);
  } catch (err) {
    console.error("[saveAralWeeklyAttendance] transaction failed:", err);
    return { ok: false, error: "Could not save the week. Please try again." };
  }

  // `Attendance.notes` is per-day, so a weekly remark has nowhere to live until
  // the learner has at least one marked day in the week. Count those instead of
  // dropping them silently — the grid tells the teacher.
  const remarksApplied = remarkedLearnerIds.size;
  const remarksSkipped = remarks.length - remarksApplied;

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ATTENDANCE_WEEK_SAVE,
    resource: "Attendance",
    resourceId: grade.id,
    // Counts and ids only. Remark text is learner PII and never enters an audit
    // row.
    metadata: {
      schoolId: user.schoolId,
      gradeLevelId: grade.id,
      weekStart: parsed.data.weekStart,
      upserted,
      cleared,
      remarksApplied,
      remarksSkipped,
      learnerIds,
    },
  });

  revalidatePath(`/teacher/aral/${grade.id}/attendance`);
  revalidatePath("/teacher/aral");
  for (const l of learners) {
    revalidatePath(`/teacher/aral/${l.gradeLevelId}/learners/${l.id}/attendance`);
    revalidatePath(`/teacher/grade/${l.gradeLevelId}/learners/${l.id}`);
  }
  revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });
  // The acting teacher may be the ARAL teacher while somebody else advises the
  // learner (or vice versa) — bust every affected teacher's metrics.
  for (const l of learners) {
    for (const id of [l.teacherId, l.aralTeacherId]) {
      if (id && id !== user.id) revalidateTeacherDashboard(id);
    }
  }

  return {
    ok: true,
    data: { upserted, cleared, remarksApplied, remarksSkipped },
  };
}

/**
 * Mark or clear a grade-level holiday for a single attendance date.
 * Input: `{ gradeId, date, isHoliday }`
 *
 * No UI calls this today — the per-day holiday toggle went with the daily grid.
 * The weekly grid still honours the rows it wrote: a flagged day renders locked
 * and the weekly save drops any cell landing on one. Kept so those rows stay
 * maintainable, and so a holiday surface can be rebuilt without re-deriving the
 * write path.
 */
export async function setAttendanceDayHoliday(
  input: unknown
): Promise<ActionResult<{ isHoliday: boolean }>> {
  const user = await requireSchoolUser("TEACHER");

  const parsed = z
    .object({
      gradeId: z.string().min(1),
      date: z.coerce.date(),
      isHoliday: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  // ARAL attendance: an ARAL-only teacher (no advisory section) reaches this
  // grade through the learners designated to them.
  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeId,
      deletedAt: null,
      schoolId: user.schoolId,
      ...teacherGradeScope(user.id),
    },
    select: { id: true, schoolId: true },
  });
  if (!grade) return { ok: false, error: "Grade not found" };

  const date = normalizeDate(parsed.data.date);

  await prisma.attendanceDayMeta.upsert({
    where: { gradeLevelId_date: { gradeLevelId: grade.id, date } },
    create: {
      gradeLevelId: grade.id,
      date,
      isHoliday: parsed.data.isHoliday,
      recordedById: user.id,
    },
    update: {
      isHoliday: parsed.data.isHoliday,
      recordedById: user.id,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.ATTENDANCE_DAY_HOLIDAY,
    resource: "AttendanceDayMeta",
    resourceId: grade.id,
    metadata: {
      schoolId: user.schoolId,
      gradeLevelId: grade.id,
      date: date.toISOString().slice(0, 10),
      isHoliday: parsed.data.isHoliday,
    },
  });

  revalidatePath(`/teacher/aral/${grade.id}/attendance`);
  revalidatePath("/teacher/aral");

  return { ok: true, data: { isHoliday: parsed.data.isHoliday } };
}
