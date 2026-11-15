import { describe, expect, it } from "vitest";
import {
  classifyTeacherTasks,
  countMosyDone,
  describeTaskReminder,
  dueAttendanceWeek,
  filterTeacherTaskRows,
  isHolidayWeek,
  previousMonthKey,
  resolveEndOfTermSections,
  resolveTeacherTaskPeriods,
  schoolDayStartInstant,
  type ActiveYearInput,
  type ClassifyContext,
  type TeacherTaskFacts,
} from "@/lib/teacher-tasks/rules";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import { TEACHER_TASK_KINDS,type TeacherTaskRow } from "@/lib/teacher-tasks/types";

/**
 * Pure rules for the School Head "Teacher Tasks" monitor. Dates are fixed local
 * keys. 2026-10-05 is a Monday; school year starts 2026-08-01 (UTC midnight, as
 * the school-year form stores it), so terms are Aug-Oct / Nov-Jan / Feb-Apr and
 * the First Term deadline is 2026-10-31.
 */

const YEAR: ActiveYearInput = { startDate: new Date("2026-08-01"), overrides: [] };

function ctxFor(todayKey: string, year: ActiveYearInput = YEAR, holidays: Record<string, string[]> = {}): ClassifyContext {
  return { periods: resolveTeacherTaskPeriods(todayKey, year), holidayKeysByGrade: holidays };
}

function facts(over: {
  designation?: string | null;
  advisoryMode?: TeacherTaskFacts["advisoryMode"];
  advisorySections?: TeacherTaskFacts["advisorySections"];
  aral?: Partial<TeacherTaskFacts["aral"]>;
  mosy?: Partial<TeacherTaskFacts["mosy"]>;
  endOfTerm?: Partial<TeacherTaskFacts["endOfTerm"]>;
} = {}): TeacherTaskFacts {
  return {
    teacherId: "t1",
    name: "Cruz, Juan",
    designation: over.designation ?? null,
    advisoryMode: over.advisoryMode ?? "DEFAULT",
    advisorySections: over.advisorySections ?? [{ id: "s1", label: "Grade 4 · A" }],
    aral: {
      tutored: 10,
      gradeLevelIds: ["g4"],
      attendanceRecorded: true,
      readingComplete: 10,
      profiled: 10,
      ...over.aral,
    },
    mosy: { scoped: 10, done: 10, ...over.mosy },
    endOfTerm: { excludedReason: null, learners: 10, complete: 10, ...over.endOfTerm },
  };
}

describe("dueAttendanceWeek", () => {
  it("inside the grace period (Sunday + grace not yet passed) picks the previous week", () => {
    // Week Oct 5-9 ends Sun Oct 11, deadline Oct 25 (14 grace days). Oct 21 is inside grace.
    expect(dueAttendanceWeek("2026-10-21")).toEqual({ mondayKey: "2026-09-28", fridayKey: "2026-10-02" });
  });

  it("on the deadline day itself the week is still not due", () => {
    expect(dueAttendanceWeek("2026-10-25").mondayKey).toBe("2026-09-28");
  });

  it("the day after the deadline picks that week", () => {
    expect(dueAttendanceWeek("2026-10-26")).toEqual({ mondayKey: "2026-10-05", fridayKey: "2026-10-09" });
  });
});

describe("ATTENDANCE", () => {
  it("any one mark in the due week is DONE", () => {
    const { tasks } = classifyTeacherTasks(facts({ aral: { attendanceRecorded: true } }), ctxFor("2026-10-26"));
    expect(tasks.ATTENDANCE.state).toBe("DONE");
  });

  it("zero marks is PENDING", () => {
    const { tasks, pendingKinds } = classifyTeacherTasks(
      facts({ aral: { attendanceRecorded: false } }),
      ctxFor("2026-10-26")
    );
    expect(tasks.ATTENDANCE.state).toBe("PENDING");
    expect(pendingKinds).toContain("ATTENDANCE");
  });

  it("a week where every school day is a holiday for every grade is NOT_APPLICABLE", () => {
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    const { tasks } = classifyTeacherTasks(
      facts({ aral: { attendanceRecorded: false } }),
      ctxFor("2026-10-26", YEAR, { g4: days })
    );
    expect(tasks.ATTENDANCE.state).toBe("NOT_APPLICABLE");
  });

  it("a week with only some holidays is still due", () => {
    const { tasks } = classifyTeacherTasks(
      facts({ aral: { attendanceRecorded: false } }),
      ctxFor("2026-10-26", YEAR, { g4: ["2026-10-05", "2026-10-06"] })
    );
    expect(tasks.ATTENDANCE.state).toBe("PENDING");
  });

  it("isHolidayWeek needs every grade on holiday, and is false with no grades", () => {
    const days = ["a", "b"];
    expect(isHolidayWeek(days, ["g1", "g2"], { g1: days, g2: ["a"] })).toBe(false);
    expect(isHolidayWeek(days, ["g1", "g2"], { g1: days, g2: days })).toBe(true);
    expect(isHolidayWeek(days, [], {})).toBe(false);
  });

  it("a due week before the school year started is NOT_APPLICABLE", () => {
    // Due week for 2026-08-10 is Jul 20-24 (before Aug 1 start).
    const { tasks } = classifyTeacherTasks(facts({ aral: { attendanceRecorded: false } }), ctxFor("2026-08-10"));
    expect(tasks.ATTENDANCE.state).toBe("NOT_APPLICABLE");
  });

  it("no ARAL learners is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(
      facts({ aral: { tutored: 0, gradeLevelIds: [], attendanceRecorded: false } }),
      ctxFor("2026-10-26")
    );
    expect(tasks.ATTENDANCE.state).toBe("NOT_APPLICABLE");
  });

  it("no active school year is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(facts({ aral: { attendanceRecorded: false } }), ctxFor("2026-10-26", null));
    expect(tasks.ATTENDANCE.state).toBe("NOT_APPLICABLE");
  });
});

describe("READING_LEVEL", () => {
  it("uses the previous calendar month, December for a January date", () => {
    expect(previousMonthKey("2027-01-15")).toBe("2026-12");
    expect(resolveTeacherTaskPeriods("2027-01-15", YEAR).reading).toMatchObject({
      monthKey: "2026-12",
      startKey: "2026-12-01",
      endExclusiveKey: "2027-01-01",
      label: "December 2026",
    });
    expect(previousMonthKey("2026-10-14")).toBe("2026-09");
  });

  it("all learners assessed is DONE", () => {
    const { tasks } = classifyTeacherTasks(facts({ aral: { readingComplete: 10 } }), ctxFor("2026-10-14"));
    expect(tasks.READING_LEVEL).toMatchObject({ state: "DONE", missing: 0, total: 10 });
  });

  it("one missing is PENDING with missing/total", () => {
    const { tasks } = classifyTeacherTasks(facts({ aral: { readingComplete: 9 } }), ctxFor("2026-10-14"));
    expect(tasks.READING_LEVEL).toMatchObject({ state: "PENDING", missing: 1, total: 10 });
  });

  it("no ARAL learners is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(
      facts({ aral: { tutored: 0, readingComplete: 0 } }),
      ctxFor("2026-10-14")
    );
    expect(tasks.READING_LEVEL.state).toBe("NOT_APPLICABLE");
  });

  it("a reading month before the school year started is NOT_APPLICABLE", () => {
    // Today Aug 10 -> July, which ended before the Aug 1 start.
    const { tasks } = classifyTeacherTasks(facts({ aral: { readingComplete: 0 } }), ctxFor("2026-08-10"));
    expect(tasks.READING_LEVEL.state).toBe("NOT_APPLICABLE");
  });
});

describe("ARAL_PROFILING", () => {
  it("any learner without a profile is PENDING", () => {
    const { tasks } = classifyTeacherTasks(facts({ aral: { profiled: 9 } }), ctxFor("2026-10-14"));
    expect(tasks.ARAL_PROFILING).toMatchObject({ state: "PENDING", missing: 1, total: 10 });
  });

  it("everyone profiled is DONE", () => {
    const { tasks } = classifyTeacherTasks(facts({ aral: { profiled: 10 } }), ctxFor("2026-10-14"));
    expect(tasks.ARAL_PROFILING.state).toBe("DONE");
  });

  it("no ARAL learners is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(facts({ aral: { tutored: 0, profiled: 0 } }), ctxFor("2026-10-14"));
    expect(tasks.ARAL_PROFILING.state).toBe("NOT_APPLICABLE");
  });
});

describe("MOSY", () => {
  it("before the Second Term starts is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(facts({ mosy: { done: 0 } }), ctxFor("2026-10-31"));
    expect(tasks.MOSY.state).toBe("NOT_APPLICABLE");
  });

  it("on the first day of the Second Term unfinished learners are PENDING", () => {
    const { tasks } = classifyTeacherTasks(facts({ mosy: { scoped: 10, done: 4 } }), ctxFor("2026-11-01"));
    expect(tasks.MOSY).toMatchObject({ state: "PENDING", missing: 6, total: 10 });
  });

  it("all decisions made is DONE", () => {
    const { tasks } = classifyTeacherTasks(facts({ mosy: { done: 10 } }), ctxFor("2026-11-15"));
    expect(tasks.MOSY.state).toBe("DONE");
  });

  it("a null decision counts as not done", () => {
    const done = countMosyDone([
      { isAralLearner: true, decision: null, hasRow: true },
      { isAralLearner: true, decision: null, hasRow: false },
      { isAralLearner: true, decision: "STAY", hasRow: true },
      { isAralLearner: false, decision: "MOVE_OUT", hasRow: true },
      { isAralLearner: true, decision: "MOVE_OUT", hasRow: true },
    ]);
    expect(done).toBe(2); // STAY + MOVE_OUT of a learner no longer tagged ARAL
  });

  it("FLOATING is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(
      facts({ advisoryMode: "FLOATING", mosy: { done: 0 } }),
      ctxFor("2026-11-15")
    );
    expect(tasks.MOSY.state).toBe("NOT_APPLICABLE");
  });

  it("no advisory section is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(
      facts({ advisorySections: [], mosy: { scoped: 0, done: 0 } }),
      ctxFor("2026-11-15")
    );
    expect(tasks.MOSY.state).toBe("NOT_APPLICABLE");
  });

  it("an ARAL volunteer is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(
      facts({ designation: ARAL_VOLUNTEER_DESIGNATION, mosy: { done: 0 } }),
      ctxFor("2026-11-15")
    );
    expect(tasks.MOSY.state).toBe("NOT_APPLICABLE");
    expect(tasks.END_OF_TERM.state).toBe("NOT_APPLICABLE");
  });
});

describe("END_OF_TERM", () => {
  it("no ended term is NOT_APPLICABLE", () => {
    expect(resolveTeacherTaskPeriods("2026-10-31", YEAR).endOfTerm).toBeNull();
    const { tasks } = classifyTeacherTasks(facts({ endOfTerm: { complete: 0 } }), ctxFor("2026-10-31"));
    expect(tasks.END_OF_TERM.state).toBe("NOT_APPLICABLE");
  });

  it("the day after a term's deadline that term is used", () => {
    expect(resolveTeacherTaskPeriods("2026-11-01", YEAR).endOfTerm?.term).toBe("FIRST");
  });

  it("uses the latest term whose deadline has passed", () => {
    expect(resolveTeacherTaskPeriods("2027-02-01", YEAR).endOfTerm?.term).toBe("SECOND");
    expect(resolveTeacherTaskPeriods("2027-01-31", YEAR).endOfTerm?.term).toBe("FIRST");
  });

  it("an overridden deadline moves the term that counts", () => {
    const year: ActiveYearInput = {
      startDate: new Date("2026-08-01"),
      overrides: [{ term: "FIRST", startKey: "2026-08-01", endKey: "2026-10-31", deadlineKey: "2026-11-30" }],
    };
    expect(resolveTeacherTaskPeriods("2026-11-15", year).endOfTerm).toBeNull();
    expect(resolveTeacherTaskPeriods("2026-12-01", year).endOfTerm?.term).toBe("FIRST");
  });

  it("missing one subject grade is PENDING", () => {
    const { tasks } = classifyTeacherTasks(
      facts({ endOfTerm: { learners: 10, complete: 9 } }),
      ctxFor("2026-11-01")
    );
    expect(tasks.END_OF_TERM).toMatchObject({ state: "PENDING", missing: 1, total: 10 });
  });

  it("all graded is DONE", () => {
    const { tasks } = classifyTeacherTasks(facts(), ctxFor("2026-11-01"));
    expect(tasks.END_OF_TERM.state).toBe("DONE");
  });

  it("a Kinder-only adviser is NOT_APPLICABLE", () => {
    const scope = resolveEndOfTermSections([{ gradeLevelId: "gk", gradeType: "KINDER" }], { gk: 5 });
    expect(scope).toEqual({ included: [], excludedReason: "KINDER" });
    const { tasks } = classifyTeacherTasks(
      facts({ endOfTerm: { excludedReason: "KINDER", learners: 0, complete: 0 } }),
      ctxFor("2026-11-01")
    );
    expect(tasks.END_OF_TERM.state).toBe("NOT_APPLICABLE");
  });

  it("Kinder sections are dropped but other sections stay", () => {
    const scope = resolveEndOfTermSections(
      [
        { gradeLevelId: "gk", gradeType: "KINDER" },
        { gradeLevelId: "g4", gradeType: "G4" },
      ],
      { gk: 5, g4: 5 }
    );
    expect(scope.excludedReason).toBeNull();
    expect(scope.included.map((s) => s.gradeLevelId)).toEqual(["g4"]);
  });

  it("a grade with zero subjects is excluded", () => {
    const sections = [
      { gradeLevelId: "g3", gradeType: "G3" },
      { gradeLevelId: "g4", gradeType: "G4" },
    ];
    expect(resolveEndOfTermSections(sections, { g3: 0, g4: 6 }).included.map((s) => s.gradeLevelId)).toEqual(["g4"]);
    expect(resolveEndOfTermSections(sections, { g3: 0 })).toEqual({ included: [], excludedReason: "NO_SUBJECTS" });
    const { tasks } = classifyTeacherTasks(
      facts({ endOfTerm: { excludedReason: "NO_SUBJECTS", learners: 0, complete: 0 } }),
      ctxFor("2026-11-01")
    );
    expect(tasks.END_OF_TERM.state).toBe("NOT_APPLICABLE");
  });

  it("no sections at all reports NO_SECTIONS", () => {
    expect(resolveEndOfTermSections([], {})).toEqual({ included: [], excludedReason: "NO_SECTIONS" });
  });

  it("FLOATING adviser is NOT_APPLICABLE", () => {
    const { tasks } = classifyTeacherTasks(facts({ advisoryMode: "FLOATING" }), ctxFor("2026-11-01"));
    expect(tasks.END_OF_TERM.state).toBe("NOT_APPLICABLE");
  });
});

describe("classifyTeacherTasks pendingKinds", () => {
  it("lists only PENDING kinds in display order", () => {
    const { pendingKinds } = classifyTeacherTasks(
      facts({
        aral: { attendanceRecorded: false, readingComplete: 0, profiled: 0 },
        mosy: { done: 0 },
        endOfTerm: { complete: 0 },
      }),
      ctxFor("2026-11-19")
    );
    expect(pendingKinds).toEqual([...TEACHER_TASK_KINDS]);
  });

  it("is empty when everything is done", () => {
    expect(classifyTeacherTasks(facts(), ctxFor("2026-11-19")).pendingKinds).toEqual([]);
  });
});

describe("filterTeacherTaskRows", () => {
  const row = (id: string, pendingKinds: TeacherTaskRow["pendingKinds"]) =>
    ({ teacherId: id, pendingKinds }) as TeacherTaskRow;
  const rows = [row("a", ["MOSY"]), row("b", []), row("c", ["ATTENDANCE", "MOSY"])];

  it("keeps everything when not only pending", () => {
    expect(filterTeacherTaskRows(rows, { onlyPending: false, kind: "MOSY" })).toHaveLength(3);
  });
  it("only pending drops teachers with nothing pending", () => {
    expect(filterTeacherTaskRows(rows, { onlyPending: true, kind: null }).map((r) => r.teacherId)).toEqual(["a", "c"]);
  });
  it("only pending on one kind narrows to that kind", () => {
    expect(
      filterTeacherTaskRows(rows, { onlyPending: true, kind: "ATTENDANCE" }).map((r) => r.teacherId)
    ).toEqual(["c"]);
  });
});

describe("schoolDayStartInstant", () => {
  it("is Manila midnight, 16:00 UTC the day before", () => {
    expect(schoolDayStartInstant("2026-10-14").toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });
});

describe("describeTaskReminder (bell text)", () => {
  it("lists labels in display order regardless of input order, once each", () => {
    expect(describeTaskReminder(["ATTENDANCE", "MOSY", "ATTENDANCE", "END_OF_TERM"])).toBe(
      "Your School Head reminded you to finish: MOSY, Attendance, End-of-term."
    );
  });

  it("ignores unknown kinds", () => {
    expect(describeTaskReminder(["BOGUS", "READING_LEVEL", "mosy"])).toBe(
      "Your School Head reminded you to finish: Reading level."
    );
  });

  it("falls back to a general sentence when nothing is known", () => {
    expect(describeTaskReminder(["BOGUS"])).toBe("Your School Head reminded you to finish your pending tasks.");
    expect(describeTaskReminder([])).toBe("Your School Head reminded you to finish your pending tasks.");
  });
});
