import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real `where` clauses `queries.ts` sends. Prisma is a recording fake, so
 * these assertions are about what the code ASKS for (tenant scope, live-row
 * filters, the due periods, a fixed query count), not about what a database
 * would return.
 *
 * Fixed date: 2027-02-17 (Wednesday). School year starts 2026-08-01, so terms
 * are Aug-Oct / Nov-Jan / Feb-Apr. The due attendance week is Mon 2027-01-25 to
 * Fri 2027-01-29 (the week of Feb 1 is still inside its grace period), the
 * reading month is January 2027, and the latest ended term is the second.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>) => fn(),
}));

type Where = Record<string, any>;
type Call = { model: string; args: { where?: Where; [k: string]: any } };

const SCHOOL = "school-1";
const TODAY = "2027-02-17";
const GRADE = { id: "g4", type: "GRADE_4" };

let calls: Call[];
let teacherCount: number;

function teacherIds(): string[] {
  return Array.from({ length: teacherCount }, (_, i) => `t${i + 1}`);
}

function record(model: string, args: Call["args"]): void {
  calls.push({ model, args });
}

const db = {
  user: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("user", args);
      const only = args.where?.id as string | undefined;
      return teacherIds()
        .filter((id) => !only || id === only)
        .map((id) => ({
          id,
          firstName: id,
          middleName: null,
          lastName: "Cruz",
          teacherProfile: { designation: null, advisoryMode: "DEFAULT" },
        }));
    }),
  },
  schoolYear: {
    findFirst: vi.fn(async (args: Call["args"]) => {
      record("schoolYear", args);
      return { id: "sy1", startDate: new Date("2026-08-01"), termWindowOverrides: [] };
    }),
  },
  section: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("section", args);
      const ids = args.where!.adviserId.in as string[];
      return ids.map((id) => ({
        id: `sec-${id}`,
        name: `A-${id}`,
        adviserId: id,
        gradeLevelId: GRADE.id,
        gradeLevel: { type: GRADE.type },
      }));
    }),
  },
  learner: {
    findMany: vi.fn(async (args: Call["args"]) => {
      const where = args.where!;
      if (where.aralTeacherId) {
        record("learner:tutored", args);
        return (where.aralTeacherId.in as string[]).map((id) => ({
          id: `l-${id}`,
          aralTeacherId: id,
          gradeLevelId: GRADE.id,
          gradeLevel: { type: GRADE.type },
          aralProfile: null,
        }));
      }
      if (where.AND) {
        record("learner:mosy", args);
        return [];
      }
      record("learner:endOfTerm", args);
      return [];
    }),
  },
  attendance: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("attendance", args);
      return [];
    }),
  },
  attendanceDayMeta: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("attendanceDayMeta", args);
      return [];
    }),
  },
  readingLevelRecord: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("readingLevelRecord", args);
      return [];
    }),
  },
  termSubject: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("termSubject", args);
      return [{ id: "subj1", gradeLevelId: GRADE.id, deletedAt: null }];
    }),
  },
  termSubjectDefault: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("termSubjectDefault", args);
      return [];
    }),
  },
  termGrade: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("termGrade", args);
      return [];
    }),
  },
  notification: {
    findMany: vi.fn(async (args: Call["args"]) => {
      record("notification", args);
      return [];
    }),
  },
};

vi.mock("@/lib/prisma", () => ({ prismaFresh: db, prisma: db }));

// Imported after `db` exists: `queries.ts` binds `prismaFresh` at module load.
const loadTeacherTaskSummaryFresh: typeof import("@/lib/teacher-tasks/queries").loadTeacherTaskSummaryFresh = (
  ...args
) => import("@/lib/teacher-tasks/queries").then((m) => m.loadTeacherTaskSummaryFresh(...args));

const named = (model: string) => calls.filter((c) => c.model === model);
const one = (model: string): Call => {
  const found = named(model);
  expect(found, `${model} query ran exactly once`).toHaveLength(1);
  return found[0]!;
};
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

beforeEach(() => {
  calls = [];
  teacherCount = 3;
  vi.clearAllMocks();
});

describe("loadTeacherTaskSummaryFresh - tenancy", () => {
  it("every query is scoped to the school, directly or through its relation", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);

    expect(one("user").args.where!.schoolId).toBe(SCHOOL);
    expect(one("schoolYear").args.where!.schoolId).toBe(SCHOOL);
    expect(one("section").args.where!.schoolId).toBe(SCHOOL);
    expect(one("learner:tutored").args.where!.schoolId).toBe(SCHOOL);
    expect(one("learner:mosy").args.where!.schoolId).toBe(SCHOOL);
    expect(one("learner:endOfTerm").args.where!.schoolId).toBe(SCHOOL);
    expect(one("termSubject").args.where!.schoolId).toBe(SCHOOL);
    // Through the learner relation.
    expect(one("attendance").args.where!.learner.schoolId).toBe(SCHOOL);
    expect(one("termGrade").args.where!.learner.schoolId).toBe(SCHOOL);
    const reading = one("readingLevelRecord").args.where!;
    expect(reading.AND.some((w: Where) => w.learner?.schoolId === SCHOOL)).toBe(true);
    // Through the grade.
    expect(one("attendanceDayMeta").args.where!.gradeLevel).toEqual({ schoolId: SCHOOL });
  });

  it("the school id is never read from anywhere but the argument (a different school flows through every query)", async () => {
    await loadTeacherTaskSummaryFresh("school-other", TODAY);
    const schoolIds = calls
      .map((c) => c.args.where?.schoolId)
      .filter((v): v is string => v !== undefined);
    expect(schoolIds.length).toBeGreaterThan(0);
    expect(schoolIds.every((id) => id === "school-other")).toBe(true);
  });
});

describe("loadTeacherTaskSummaryFresh - roster and learner scope", () => {
  it("the teacher roster is the active, approved, non-deleted TEACHER scope", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    expect(one("user").args.where).toMatchObject({
      schoolId: SCHOOL,
      role: "TEACHER",
      deletedAt: null,
      approvalStatus: "APPROVED",
      isActive: true,
    });
  });

  it("every learner query excludes deleted and archived learners", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    for (const model of ["learner:tutored", "learner:mosy", "learner:endOfTerm"]) {
      expect(one(model).args.where, model).toMatchObject({ deletedAt: null, archivedAt: null });
    }
    // The relation filters reuse the same live-learner predicate.
    for (const model of ["attendance", "termGrade"]) {
      expect(one(model).args.where!.learner, model).toMatchObject({ deletedAt: null, archivedAt: null });
    }
    const reading = one("readingLevelRecord").args.where!;
    expect(
      reading.AND.some((w: Where) => w.learner?.deletedAt === null && w.learner?.archivedAt === null)
    ).toBe(true);
  });

  it("the tutored population is ARAL learners of the listed teachers only", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    const where = one("learner:tutored").args.where!;
    expect(where.isAralLearner).toBe(true);
    expect(where.aralTeacherId).toEqual({ in: ["t1", "t2", "t3"] });
  });

  it("sections are live and limited to the roster's advisers", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    expect(one("section").args.where).toEqual({
      schoolId: SCHOOL,
      deletedAt: null,
      adviserId: { in: ["t1", "t2", "t3"] },
    });
  });
});

describe("loadTeacherTaskSummaryFresh - teacherId option", () => {
  it("narrows the roster and every dependent query to that one teacher", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY, { teacherId: "t2" });
    expect(one("user").args.where!.id).toBe("t2");
    expect(one("user").args.where!.schoolId).toBe(SCHOOL);
    expect(one("section").args.where!.adviserId).toEqual({ in: ["t2"] });
    expect(one("learner:tutored").args.where!.aralTeacherId).toEqual({ in: ["t2"] });
  });

  it("without the option the roster is not narrowed by id", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    expect(one("user").args.where).not.toHaveProperty("id");
  });

  it("a teacher outside the school yields no rows and stops before any learner query", async () => {
    db.user.findMany.mockImplementationOnce(async (args: Call["args"]) => {
      record("user", args);
      return [];
    });
    const summary = await loadTeacherTaskSummaryFresh(SCHOOL, TODAY, { teacherId: "t-foreign" });
    expect(summary.rows).toEqual([]);
    expect(named("learner:tutored")).toHaveLength(0);
    expect(named("notification")).toHaveLength(0);
  });
});

describe("loadTeacherTaskSummaryFresh - due periods", () => {
  it("ATTENDANCE asks for the due week, Monday to Friday, and the same range for holidays", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    const attendance = one("attendance").args.where!;
    expect(attendance.date.gte.getTime()).toBe(day(2027, 1, 25));
    expect(attendance.date.lte.getTime()).toBe(day(2027, 1, 29));

    const meta = one("attendanceDayMeta").args.where!;
    expect(meta.isHoliday).toBe(true);
    expect(meta.date.gte.getTime()).toBe(day(2027, 1, 25));
    expect(meta.date.lte.getTime()).toBe(day(2027, 1, 29));
    expect(meta.gradeLevelId).toEqual({ in: [GRADE.id] });
  });

  it("READING asks for the previous calendar month as a half-open range", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    const { weekStart } = one("readingLevelRecord").args.where!;
    expect(weekStart.gte.getTime()).toBe(day(2027, 1, 1));
    expect(weekStart.lt.getTime()).toBe(day(2027, 2, 1));
  });

  it("the due week moves with today: inside the grace period it is still the earlier week", async () => {
    // Fri 2027-02-19: the week of Feb 1 (deadline Feb 21) is not yet due.
    await loadTeacherTaskSummaryFresh(SCHOOL, "2027-02-19");
    expect(one("attendance").args.where!.date.gte.getTime()).toBe(day(2027, 1, 25));
    calls = [];
    // Tue 2027-02-23: it is due now.
    await loadTeacherTaskSummaryFresh(SCHOOL, "2027-02-23");
    expect(one("attendance").args.where!.date.gte.getTime()).toBe(day(2027, 2, 1));
    expect(one("attendance").args.where!.date.lte.getTime()).toBe(day(2027, 2, 5));
  });

  it("the reading month rolls over at the month boundary", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, "2027-03-02");
    const { weekStart } = one("readingLevelRecord").args.where!;
    expect(weekStart.gte.getTime()).toBe(day(2027, 2, 1));
    expect(weekStart.lt.getTime()).toBe(day(2027, 3, 1));
  });

  it("the end-of-term reads are for the latest ended term and the active year", async () => {
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    const grades = one("termGrade").args.where!;
    expect(grades.schoolYearId).toBe("sy1");
    expect(grades.term).toBe("SECOND");
    expect(grades.termSubjectId).toEqual({ in: ["subj1"] });
  });

  it("with no active school year, no attendance, reading, MOSY or term query runs", async () => {
    db.schoolYear.findFirst.mockImplementationOnce(async (args: Call["args"]) => {
      record("schoolYear", args);
      return null as never;
    });
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    for (const model of [
      "attendance",
      "attendanceDayMeta",
      "readingLevelRecord",
      "learner:mosy",
      "termSubject",
      "termGrade",
    ]) {
      expect(named(model), model).toHaveLength(0);
    }
  });
});

describe("loadTeacherTaskSummaryFresh - no N+1", () => {
  it("runs the same number of queries for 1 teacher as for 40", async () => {
    teacherCount = 1;
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    const few = calls.length;

    calls = [];
    teacherCount = 40;
    await loadTeacherTaskSummaryFresh(SCHOOL, TODAY);
    const many = calls.length;

    expect(few).toBeGreaterThanOrEqual(10);
    expect(many).toBe(few);
    // And the 40 teachers travel in one `in` list, not one query each.
    expect(one("learner:tutored").args.where!.aralTeacherId.in).toHaveLength(40);
  });
});
