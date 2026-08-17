import { describe, it, expect } from "vitest";
import {
  buildDashboardTasks,
  daysUntil,
  endOfMonth,
  endOfSchoolWeek,
  type TeacherOverview,
} from "@/lib/dashboard/teacher-overview";
import { schoolToday, formatLocalDateKey } from "@/lib/date-keys";

function overview(over: Partial<TeacherOverview> = {}): TeacherOverview {
  return {
    todayKey: "2026-05-13", // Wed 13 May 2026
    weekStartKey: "2026-05-11", // Monday
    monthStartKey: "2026-05-01",
    gradeCount: 1,
    totalLearners: 15,
    aralLearners: 14,
    pendingAralProfiles: 1,
    attendance: {
      present: 18,
      late: 0,
      absent: 6,
      excused: 4,
      noClass: 0,
      totalMarks: 28,
      presentRate: 64,
    },
    reading: {
      completed: 0,
      pending: 14,
      notAssessed: 0,
      submitted: 0,
      completionRate: 0,
    },
    gradeDistribution: [],
    attendanceDaysOpen: 0,
    attendanceMarksMissing: 0,
    schoolYearLabel: "2026–2027",
    primaryAralGradeId: "grade-3",
    ...over,
  };
}

const HREFS = {
  reading: "/teacher/aral/grade-3/reading-level",
  attendance: "/teacher/aral/grade-3/attendance",
  reports: "/teacher/reports",
};

describe("date cadence helpers", () => {
  it("ends the school week on Friday", () => {
    const friday = endOfSchoolWeek(new Date(2026, 4, 11)); // Mon 11 May
    expect(formatLocalDateKey(friday)).toBe("2026-05-15");
  });

  it("ends the month on its real last day, including February", () => {
    expect(formatLocalDateKey(endOfMonth(new Date(2026, 4, 13)))).toBe("2026-05-31");
    expect(formatLocalDateKey(endOfMonth(new Date(2026, 1, 3)))).toBe("2026-02-28");
    // 2028 is a leap year.
    expect(formatLocalDateKey(endOfMonth(new Date(2028, 1, 3)))).toBe("2028-02-29");
  });

  it("counts whole days regardless of time of day", () => {
    expect(daysUntil(new Date(2026, 4, 13, 23), new Date(2026, 4, 15, 1))).toBe(2);
    expect(daysUntil(new Date(2026, 4, 15), new Date(2026, 4, 15))).toBe(0);
    expect(daysUntil(new Date(2026, 4, 16), new Date(2026, 4, 15))).toBe(-1);
  });
});

describe("cache-boundary safety", () => {
  /**
   * `getTeacherOverview` returns through `cachedQuery` → `unstable_cache`,
   * which serialises to JSON. A `Date` field would come back as a string and
   * every date method called on it would throw at render time. These tests
   * exercise the snapshot the way the cache actually hands it back.
   */
  it("carries no Date instances — they would not survive the cache", () => {
    const walk = (value: unknown, path: string): string[] => {
      if (value instanceof Date) return [path];
      if (Array.isArray(value)) {
        return value.flatMap((v, i) => walk(v, `${path}[${i}]`));
      }
      if (value && typeof value === "object") {
        return Object.entries(value).flatMap(([k, v]) => walk(v, `${path}.${k}`));
      }
      return [];
    };
    expect(walk(overview(), "overview")).toEqual([]);
  });

  it("builds the same tasks after a JSON round-trip", () => {
    const direct = buildDashboardTasks(overview(), HREFS);
    const revived = JSON.parse(JSON.stringify(overview())) as TeacherOverview;
    expect(buildDashboardTasks(revived, HREFS)).toEqual(direct);
  });
});

describe("buildDashboardTasks", () => {
  it("derives due dates from cadence, never from a stored deadline", () => {
    const tasks = buildDashboardTasks(overview(), HREFS);
    expect(tasks.map((t) => t.id)).toEqual(["reading", "attendance", "reports"]);
    expect(tasks[0].detail).toBe("Due May 31, 2026");
    expect(tasks[1].detail).toBe("Due May 15, 2026");
  });

  it("counts real outstanding reading assessments", () => {
    const tasks = buildDashboardTasks(overview(), HREFS);
    expect(tasks[0].badge).toBe("14 pending");
    expect(tasks[0].tone).toBe("amber");
  });

  it("reports completion rather than a fake deadline when nothing is open", () => {
    const tasks = buildDashboardTasks(
      overview({
        reading: {
          completed: 14,
          pending: 0,
          notAssessed: 0,
          submitted: 14,
          completionRate: 100,
        },
      }),
      HREFS
    );
    expect(tasks[0].badge).toBe("Complete");
    expect(tasks[0].tone).toBe("muted");
  });

  it("never labels anything locked — the schema has no lock state", () => {
    const tasks = buildDashboardTasks(overview({ totalLearners: 0, aralLearners: 0 }), HREFS);
    const text = JSON.stringify(tasks).toLowerCase();
    expect(text).not.toContain("lock");
    expect(text).not.toContain("submitted");
  });

  it("shows days remaining while attendance is still unmarked", () => {
    const tasks = buildDashboardTasks(
      overview({
        attendance: { ...overview().attendance, noClass: 12 },
      }),
      HREFS
    );
    // Wed 13 May → Fri 15 May.
    expect(tasks[1].badge).toBe("2 days left");
    expect(tasks[1].tone).toBe("primary");
  });
});

describe("schoolToday", () => {
  it("resolves the Manila civil date, not the runtime's UTC date", () => {
    expect(formatLocalDateKey(schoolToday(new Date("2026-08-13T22:30:00.000Z")))).toBe(
      "2026-08-14"
    );
    expect(formatLocalDateKey(schoolToday(new Date("2026-08-13T02:00:00.000Z")))).toBe(
      "2026-08-13"
    );
  });
});
