// A local-midnight Date in Asia/Manila is 16:00 the previous day in UTC, so an
// audit date derived through toISOString() would log the day before.
process.env.TZ = "Asia/Manila";

import { beforeEach, describe, expect, it, vi } from "vitest";

const SCHOOL_ID = "school-1";
const GRADE_ID = "grade-1";

const upsert = vi.fn(async (_args: unknown) => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gradeLevel: { findFirst: async () => ({ id: GRADE_ID, schoolId: SCHOOL_ID }) },
    attendanceDayMeta: { upsert: (a: unknown) => upsert(a) },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: async () => ({ id: "t1", schoolId: SCHOOL_ID, role: "TEACHER" }),
}));

const writeAudit = vi.fn(async (_e: { metadata: Record<string, unknown> }) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...(a as [never])),
  AUDIT_ACTIONS: { ATTENDANCE_DAY_HOLIDAY: "ATTENDANCE_DAY_HOLIDAY" },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateTeacherDashboard: vi.fn(),
}));
vi.mock("@/lib/teachers/scope", () => ({
  aralLearnerScope: () => ({}),
  teacherGradeScope: () => ({}),
  teacherIsAralTutorFor: async () => true,
}));

const { setAttendanceDayHoliday } = await import("@/lib/actions/attendance");

describe("setAttendanceDayHoliday audit metadata", () => {
  beforeEach(() => {
    writeAudit.mockClear();
    upsert.mockClear();
  });

  it("logs the YYYY-MM-DD key it was given, not a UTC-shifted day", async () => {
    const res = await setAttendanceDayHoliday({
      gradeId: GRADE_ID,
      date: "2026-06-01",
      isHoliday: true,
    });
    expect(res.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit.mock.calls[0]![0].metadata.date).toBe("2026-06-01");
  });

  it("rejects a date that is not a calendar day key", async () => {
    const res = await setAttendanceDayHoliday({
      gradeId: GRADE_ID,
      date: "2026-02-30",
      isHoliday: true,
    });
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
