import "server-only";
import type { GradeLevelType, Prisma } from "@prisma/client";
import { prismaFresh } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolDashboard, schoolTeacherTasks } from "@/lib/cache/tags";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { formatListingNameFromRecord } from "@/lib/names";
import { completeAssessmentWhereForGrades } from "@/lib/reading/policy";
import { teacherRosterScope, TEACHER_ROSTER_STATE } from "@/lib/teachers/roster";
import { mosyLearnerScope } from "@/lib/teachers/scope";
import { computeSheetStats } from "@/lib/terms/sheet-view";
import { isKinderGradeType } from "@/lib/terms/kinder-competencies";
import {
  adviserTaskDenial,
  buildTeacherTaskSummary,
  classifyTeacherTasks,
  countMosyDone,
  resolveEndOfTermSections,
  resolveTeacherTaskPeriods,

  type TeacherTaskFacts,
} from "@/lib/teacher-tasks/rules";
import type { TeacherTaskRow, TeacherTaskSummary } from "@/lib/teacher-tasks/types";

/**
 * Teacher Tasks — gathering the facts for ONE school.
 *
 * Every active, approved teacher of the school is covered by a fixed number of
 * queries (about ten, in four rounds), whatever the head count: each read is a
 * `findMany` over the whole school keyed by teacher id, and the rows are grouped
 * by teacher in memory. Nothing here runs a query per teacher.
 *
 * Tenancy: every `where` carries `schoolId` — directly, or through the learner
 * relation for Attendance / ReadingLevelRecord / TermGrade, or through the grade
 * for AttendanceDayMeta. `schoolId` is the caller's already-resolved school
 * (the session's, or a Super Admin's checked school view); nothing here reads
 * it from the client.
 *
 * Reads go through `prismaFresh`: the monitor shows other people's saves, which
 * the read-your-own-writes routing of `prisma` does not guarantee.
 */

const db = prismaFresh;

/** Live learners only — the population every task counts. */
function liveLearners(schoolId: string): Prisma.LearnerWhereInput {
  return { schoolId, deletedAt: null, archivedAt: null };
}

type SectionRow = {
  id: string;
  label: string;
  adviserId: string;
  gradeLevelId: string;
  gradeType: string;
};

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * The summary without `remindedToday` (every row `false`). JSON-safe, so it can
 * sit in the Data Cache. `teacherId` narrows the roster to one teacher — the
 * same queries, one id in each `in` list.
 */
async function gatherTeacherTaskSummary(
  schoolId: string,
  todayKey: string,
  teacherId?: string
): Promise<TeacherTaskSummary> {
  const [teachers, activeYear] = await Promise.all([
    db.user.findMany({
      where: {
        ...teacherRosterScope(schoolId),
        ...TEACHER_ROSTER_STATE.active,
        ...(teacherId ? { id: teacherId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        teacherProfile: { select: { designation: true, advisoryMode: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    }),
    db.schoolYear.findFirst({
      where: { schoolId, isActive: true },
      select: {
        id: true,
        startDate: true,
        termWindowOverrides: {
          select: { term: true, startKey: true, endKey: true, deadlineKey: true },
        },
      },
    }),
  ]);

  const periods = resolveTeacherTaskPeriods(
    todayKey,
    activeYear ? { startDate: activeYear.startDate, overrides: activeYear.termWindowOverrides } : null
  );
  if (teachers.length === 0) return buildTeacherTaskSummary(periods, []);

  const teacherIds = teachers.map((t) => t.id);

  // The tutor population, `aralLearnerScope` for every teacher at once.
  const tutoredWhere: Prisma.LearnerWhereInput = {
    ...liveLearners(schoolId),
    isAralLearner: true,
    aralTeacherId: { in: teacherIds },
  };

  // Round 2: advisory sections (the same filters `getAdvisoryPlacements` uses,
  // for every adviser at once) and the tutored learners.
  const [sectionRows, tutored] = await Promise.all([
    db.section.findMany({
      where: { schoolId, deletedAt: null, adviserId: { in: teacherIds } },
      select: {
        id: true,
        name: true,
        adviserId: true,
        gradeLevelId: true,
        gradeLevel: { select: { type: true } },
      },
      orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
    }),
    db.learner.findMany({
      where: tutoredWhere,
      select: {
        id: true,
        aralTeacherId: true,
        gradeLevelId: true,
        gradeLevel: { select: { type: true } },
        aralProfile: { select: { id: true } },
      },
    }),
  ]);

  const sections: SectionRow[] = sectionRows.map((s) => {
    const gradeLabel = GRADE_LEVEL_LABELS[s.gradeLevel.type] ?? s.gradeLevel.type;
    return {
      id: s.id,
      label: `${gradeLabel} · ${s.name}`,
      // Non-null: the `where` asked for `adviserId in teacherIds`.
      adviserId: s.adviserId!,
      gradeLevelId: s.gradeLevelId,
      gradeType: s.gradeLevel.type,
    };
  });
  const sectionsByTeacher = groupBy(sections, (s) => s.adviserId);
  const tutoredByTeacher = groupBy(tutored, (l) => l.aralTeacherId);

  // Adviser tasks apply only to teachers who pass the MOSY / term-sheet guards.
  const adviserIds = new Set(
    teachers
      .filter(
        (t) =>
          adviserTaskDenial({
            designation: t.teacherProfile?.designation ?? null,
            advisoryMode: t.teacherProfile?.advisoryMode ?? null,
            advisorySections: sectionsByTeacher.get(t.id) ?? [],
          }) === null
      )
      .map((t) => t.id)
  );
  const adviserSections = sections.filter((s) => adviserIds.has(s.adviserId));

  // Round 3: everything that only needs the ids above.
  const week = periods.attendance;
  const month = periods.reading;
  const checkAttendance =
    tutored.length > 0 && periods.hasActiveYear && !week.beforeYearStart;
  const checkReading = tutored.length > 0 && periods.hasActiveYear && !month.beforeYearStart;
  const checkMosy = activeYear !== null && periods.mosy?.started === true && adviserSections.length > 0;
  const checkEndOfTerm = activeYear !== null && periods.endOfTerm !== null && adviserSections.length > 0;

  const tutoredGrades = [
    ...new Map(tutored.map((l) => [l.gradeLevelId, { id: l.gradeLevelId, type: l.gradeLevel.type }])).values(),
  ];
  const weekStart = parseLocalDateKey(week.mondayKey);
  const weekFriday = parseLocalDateKey(week.fridayKey);

  // Grade types that can have a subject sheet, for the Super Admin template
  // read below (Kindergarten is never seeded — `getAllTermSubjects`).
  const adviserSheetGradeTypes = [
    ...new Set(adviserSections.map((s) => s.gradeType).filter((t) => !isKinderGradeType(t))),
  ] as GradeLevelType[];

  const [attendanceRows, holidayRows, readingRows, mosyRows, subjectRows, defaultRows] = await Promise.all([
    checkAttendance
      ? db.attendance.findMany({
          where: { date: { gte: weekStart, lte: weekFriday }, learner: tutoredWhere },
          select: { learnerId: true },
          distinct: ["learnerId"],
        })
      : Promise.resolve([]),
    checkAttendance
      ? db.attendanceDayMeta.findMany({
          where: {
            isHoliday: true,
            date: { gte: weekStart, lte: weekFriday },
            gradeLevelId: { in: tutoredGrades.map((g) => g.id) },
            gradeLevel: { schoolId },
          },
          select: { gradeLevelId: true, date: true },
        })
      : Promise.resolve([]),
    checkReading
      ? db.readingLevelRecord.findMany({
          where: {
            // A range, not the month anchor: rows from the retired weekly grid
            // sit on Mondays inside the month (`countMonthlyAssessmentProgress`).
            weekStart: {
              gte: parseLocalDateKey(month.startKey),
              lt: parseLocalDateKey(month.endExclusiveKey),
            },
            // `AND`, not a spread: the completeness predicate sets its own
            // `learner` key.
            AND: [completeAssessmentWhereForGrades(tutoredGrades), { learner: tutoredWhere }],
          },
          select: { learnerId: true },
          distinct: ["learnerId"],
        })
      : Promise.resolve([]),
    checkMosy
      ? db.learner.findMany({
          where: {
            ...liveLearners(schoolId),
            AND: [mosyLearnerScope(adviserSections.map((s) => s.id), activeYear!.id)],
          },
          select: {
            sectionId: true,
            isAralLearner: true,
            mosyDecisions: {
              where: { schoolYearId: activeYear!.id },
              take: 1,
              select: { decision: true },
            },
          },
        })
      : Promise.resolve([]),
    checkEndOfTerm
      ? db.termSubject.findMany({
          // Archived rows too: "has this grade ever been seeded" is decided on
          // ANY row, exactly as `getAllTermSubjects` decides it.
          where: {
            schoolId,
            gradeLevelId: { in: [...new Set(adviserSections.map((s) => s.gradeLevelId))] },
          },
          select: { id: true, gradeLevelId: true, deletedAt: true },
        })
      : Promise.resolve([]),
    // The Super Admin's per-type template (`TermSubjectDefault`), which carries
    // no `schoolId` — it is the same for every school and holds no school data.
    // Read only; nothing is seeded here.
    checkEndOfTerm && adviserSheetGradeTypes.length > 0
      ? db.termSubjectDefault.findMany({
          where: { deletedAt: null, gradeLevelType: { in: adviserSheetGradeTypes } },
          select: { id: true, gradeLevelType: true },
        })
      : Promise.resolve([]),
  ]);

  // End of term: which sections count, per teacher, then one roster read and
  // one grade read for all of them (round 4).
  const activeSubjectRows = subjectRows.filter((s) => s.deletedAt === null);
  const subjectIdsByGrade = new Map<string, string[]>();
  for (const s of activeSubjectRows) {
    const list = subjectIdsByGrade.get(s.gradeLevelId);
    if (list) list.push(s.id);
    else subjectIdsByGrade.set(s.gradeLevelId, [s.id]);
  }
  // A grade with NO subject rows at all has simply never been opened: the sheet
  // seeds the template defaults on first open (`getAllTermSubjects`), so the
  // teacher faces those subjects with nothing graded. Count it against the
  // template instead of calling it "no subjects set". The placeholder ids match
  // no TermGrade, so every learner of that grade is incomplete — which is the
  // truth, since no score can exist for a subject row that does not exist yet.
  // A grade whose rows were all archived keeps zero, as the sheet does.
  const gradesWithAnyRow = new Set(subjectRows.map((s) => s.gradeLevelId));
  const defaultIdsByType = groupBy(defaultRows, (d) => d.gradeLevelType);
  for (const s of adviserSections) {
    if (gradesWithAnyRow.has(s.gradeLevelId) || isKinderGradeType(s.gradeType)) continue;
    const defaults = defaultIdsByType.get(s.gradeType) ?? [];
    if (defaults.length > 0) {
      subjectIdsByGrade.set(s.gradeLevelId, defaults.map((d) => `default:${d.id}`));
    }
  }
  const subjectCountByGrade = Object.fromEntries(
    [...subjectIdsByGrade].map(([gradeId, ids]) => [gradeId, ids.length])
  );
  const endOfTermScopeByTeacher = new Map(
    [...adviserIds].map((id) => [
      id,
      resolveEndOfTermSections(sectionsByTeacher.get(id) ?? [], subjectCountByGrade),
    ])
  );
  const endOfTermSectionIds = checkEndOfTerm
    ? [...endOfTermScopeByTeacher.values()].flatMap((scope) => scope.included.map((s) => s.id))
    : [];
  const endOfTermRoster: Prisma.LearnerWhereInput = {
    ...liveLearners(schoolId),
    sectionId: { in: endOfTermSectionIds },
  };

  const [termLearners, termScores] =
    endOfTermSectionIds.length > 0
      ? await Promise.all([
          db.learner.findMany({
            where: endOfTermRoster,
            select: { id: true, sectionId: true, gradeLevelId: true },
          }),
          db.termGrade.findMany({
            where: {
              schoolYearId: activeYear!.id,
              term: periods.endOfTerm!.term,
              termSubjectId: { in: activeSubjectRows.map((s) => s.id) },
              learner: endOfTermRoster,
            },
            select: { learnerId: true, termSubjectId: true, score: true, mark: true },
          }),
        ])
      : [[], []];

  // Group the round-3/4 rows by teacher.
  const tutorOf = new Map(tutored.map((l) => [l.id, l.aralTeacherId!]));
  const recordedTeachers = new Set(
    attendanceRows.map((r) => tutorOf.get(r.learnerId)).filter((id): id is string => !!id)
  );
  const readingDone = new Map<string, number>();
  for (const r of readingRows) {
    const tutor = tutorOf.get(r.learnerId);
    if (tutor) readingDone.set(tutor, (readingDone.get(tutor) ?? 0) + 1);
  }
  const holidayKeysByGrade: Record<string, string[]> = {};
  for (const h of holidayRows) {
    (holidayKeysByGrade[h.gradeLevelId] ??= []).push(formatLocalDateKey(h.date));
  }

  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const mosyByTeacher = groupBy(mosyRows, (l) => (l.sectionId ? sectionById.get(l.sectionId)?.adviserId ?? null : null));

  // A learner is on the sheet of the section they sit in, for that section's
  // grade (`SheetScope.rosterWhere` carries both).
  const termLearnersByTeacher = groupBy(
    termLearners.filter((l) => l.sectionId && sectionById.get(l.sectionId)?.gradeLevelId === l.gradeLevelId),
    (l) => sectionById.get(l.sectionId!)?.adviserId ?? null
  );
  const scoresByLearner = groupBy(termScores, (s) => s.learnerId);
  const gradeTypeByGrade = new Map(sections.map((s) => [s.gradeLevelId, s.gradeType]));

  const rows: TeacherTaskRow[] = teachers.map((t) => {
    const advisory = sectionsByTeacher.get(t.id) ?? [];
    const mine = tutoredByTeacher.get(t.id) ?? [];
    const mosyLearners = mosyByTeacher.get(t.id) ?? [];
    const termScope = endOfTermScopeByTeacher.get(t.id);
    const myTermLearners = termLearnersByTeacher.get(t.id) ?? [];
    const termStats = computeSheetStats({
      learners: myTermLearners,
      subjectIdsByGrade,
      gradeTypeByGrade,
      scores: myTermLearners.flatMap((l) => scoresByLearner.get(l.id) ?? []),
    });

    const facts: TeacherTaskFacts = {
      teacherId: t.id,
      name: formatListingNameFromRecord(t),
      designation: t.teacherProfile?.designation ?? null,
      advisoryMode: t.teacherProfile?.advisoryMode ?? null,
      advisorySections: advisory.map((s) => ({ id: s.id, label: s.label })),
      aral: {
        tutored: mine.length,
        gradeLevelIds: [...new Set(mine.map((l) => l.gradeLevelId))],
        attendanceRecorded: recordedTeachers.has(t.id),
        readingComplete: readingDone.get(t.id) ?? 0,
        profiled: mine.filter((l) => l.aralProfile !== null).length,
      },
      mosy: {
        scoped: mosyLearners.length,
        done: countMosyDone(
          mosyLearners.map((l) => ({
            isAralLearner: l.isAralLearner,
            hasRow: l.mosyDecisions.length > 0,
            decision: l.mosyDecisions[0]?.decision ?? null,
          }))
        ),
      },
      endOfTerm: {
        excludedReason: termScope?.excludedReason ?? "NO_SECTIONS",
        learners: termStats.total,
        complete: termStats.complete,
      },
    };

    const { tasks, pendingKinds } = classifyTeacherTasks(facts, { periods, holidayKeysByGrade });
    return {
      teacherId: t.id,
      name: facts.name,
      advisorySections: facts.advisorySections,
      tasks,
      pendingKinds,
      remindedToday: false,
    };
  });

  return buildTeacherTaskSummary(periods, rows);
}

/**
 * The Teacher Tasks summary for a school, uncached. What the export uses, so a
 * downloaded file never lags the facts. `teacherId` narrows it to one teacher
 * (still a fixed number of queries).
 *
 * `todayKey` must be `formatLocalDateKey(schoolToday())`.
 */
export async function loadTeacherTaskSummaryFresh(
  schoolId: string,
  todayKey: string,
  options: { teacherId?: string } = {}
): Promise<TeacherTaskSummary> {
  return gatherTeacherTaskSummary(schoolId, todayKey, options.teacherId);
}

/**
 * The Teacher Tasks summary for the Monitoring page: the task facts from the
 * Data Cache (60 seconds, keyed by school and day).
 *
 * `todayKey` must be `formatLocalDateKey(schoolToday())`.
 */
export async function getTeacherTaskSummary(
  schoolId: string,
  todayKey: string
): Promise<TeacherTaskSummary> {
  return cachedQuery(() => gatherTeacherTaskSummary(schoolId, todayKey), {
    keyParts: ["teacher-tasks-v1", schoolId, todayKey],
    // `schoolDashboard` too: activating a school year changes every period.
    tags: [schoolTeacherTasks(schoolId), schoolDashboard(schoolId)],
    revalidate: 60,
  });
}
