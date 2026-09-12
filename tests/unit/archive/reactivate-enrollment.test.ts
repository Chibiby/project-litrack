import { beforeEach, describe, expect, it } from "vitest";
import { reactivateEnrollment } from "@/lib/learners/reactivate-enrollment";

/**
 * `reactivateEnrollment` — the one function every path that clears a
 * learner's removed/archived state calls, per spec section 4a. Four outcomes,
 * checked in order: `kept` (protects the SQL-only partial unique index),
 * `no-active-year`, `revived` (with the deliberate pointer-overwrite), and
 * `created`.
 *
 * The `revived` case is the whole reason this module was extracted (spec
 * 4a): the archived row's own `gradeLevelId`/`sectionId`/`teacherId` must be
 * overwritten with the learner's CURRENT pointers, not merely flipped back to
 * ACTIVE. A test that only checks `status: "ACTIVE"` would pass even if that
 * overwrite were deleted, so every revive assertion below uses pointer values
 * that deliberately differ from the learner's current ones.
 */

const LEARNER_ID = "learner-1";
const SCHOOL_ID = "school-1";
const YEAR_ID = "year-2026";

const CURRENT_GRADE = "grade-current";
const CURRENT_SECTION = "section-current";
const CURRENT_TEACHER = "teacher-current";

/** What the archived enrollment row was pointed at when it was archived — must differ from CURRENT_*. */
const OLD_GRADE = "grade-old";
const OLD_SECTION = "section-old";
const OLD_TEACHER = "teacher-old";

function learner(overrides: Partial<{
  gradeLevelId: string;
  sectionId: string | null;
  teacherId: string | null;
}> = {}) {
  return {
    id: LEARNER_ID,
    schoolId: SCHOOL_ID,
    gradeLevelId: CURRENT_GRADE,
    sectionId: CURRENT_SECTION,
    teacherId: CURRENT_TEACHER,
    ...overrides,
  };
}

type EnrollmentRow = {
  id: string;
  learnerId: string;
  schoolYearId: string;
  status: "ACTIVE" | "ARCHIVED";
  gradeLevelId: string | null;
  sectionId: string | null;
  teacherId: string | null;
  endedAt: Date | null;
};

let enrollments: EnrollmentRow[];
let activeYear: { id: string; schoolId: string; isActive: boolean } | null;
let nextId: number;

function makeTx() {
  return {
    enrollment: {
      findFirst: async (args: {
        where: { learnerId: string; status?: string; schoolYearId?: string };
        orderBy?: { endedAt: "desc" };
      }) => {
        const matches = enrollments.filter((e) => {
          if (e.learnerId !== args.where.learnerId) return false;
          if (args.where.status && e.status !== args.where.status) return false;
          if (args.where.schoolYearId && e.schoolYearId !== args.where.schoolYearId)
            return false;
          return true;
        });
        if (args.orderBy?.endedAt === "desc") {
          matches.sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0));
        }
        return matches[0] ?? null;
      },
      update: async (args: {
        where: { id: string };
        data: Partial<EnrollmentRow>;
      }) => {
        const row = enrollments.find((e) => e.id === args.where.id);
        if (!row) throw new Error("row not found");
        Object.assign(row, args.data);
        return { ...row };
      },
      create: async (args: { data: Omit<EnrollmentRow, "id" | "endedAt"> & { endedAt?: Date | null } }) => {
        const row: EnrollmentRow = {
          id: `enrollment-${nextId++}`,
          endedAt: null,
          ...args.data,
        };
        enrollments.push(row);
        return { ...row };
      },
    },
    schoolYear: {
      findFirst: async (args: { where: { schoolId: string; isActive: boolean } }) => {
        if (!activeYear) return null;
        if (activeYear.schoolId !== args.where.schoolId) return null;
        if (activeYear.isActive !== args.where.isActive) return null;
        return { ...activeYear };
      },
    },
    // Not exercised by this module; present so a stray call fails loudly.
  } as unknown as import("@prisma/client").Prisma.TransactionClient;
}

beforeEach(() => {
  nextId = 1;
  enrollments = [];
  activeYear = { id: YEAR_ID, schoolId: SCHOOL_ID, isActive: true };
});

describe("reactivateEnrollment — kept", () => {
  it("does nothing when an ACTIVE enrollment already exists", async () => {
    enrollments.push({
      id: "enrollment-active",
      learnerId: LEARNER_ID,
      schoolYearId: YEAR_ID,
      status: "ACTIVE",
      gradeLevelId: CURRENT_GRADE,
      sectionId: CURRENT_SECTION,
      teacherId: CURRENT_TEACHER,
      endedAt: null,
    });

    const result = await reactivateEnrollment(makeTx(), learner());

    expect(result).toEqual({ outcome: "kept", enrollmentId: "enrollment-active" });
    // Nothing else was created — this is what protects the SQL-only partial
    // unique index `Enrollment_learner_active_unique`.
    expect(enrollments).toHaveLength(1);
  });
});

describe("reactivateEnrollment — no-active-year", () => {
  it("creates nothing when the school has no active school year", async () => {
    activeYear = null;

    const result = await reactivateEnrollment(makeTx(), learner());

    expect(result).toEqual({ outcome: "no-active-year", enrollmentId: null });
    expect(enrollments).toHaveLength(0);
  });

  it("does not match an active year belonging to another school", async () => {
    activeYear = { id: YEAR_ID, schoolId: "other-school", isActive: true };

    const result = await reactivateEnrollment(makeTx(), learner());

    expect(result.outcome).toBe("no-active-year");
  });
});

describe("reactivateEnrollment — revived", () => {
  it("revives the archived row for the active year to ACTIVE with endedAt cleared", async () => {
    enrollments.push({
      id: "enrollment-archived",
      learnerId: LEARNER_ID,
      schoolYearId: YEAR_ID,
      status: "ARCHIVED",
      gradeLevelId: OLD_GRADE,
      sectionId: OLD_SECTION,
      teacherId: OLD_TEACHER,
      endedAt: new Date("2026-06-01"),
    });

    const result = await reactivateEnrollment(makeTx(), learner());

    expect(result).toEqual({ outcome: "revived", enrollmentId: "enrollment-archived" });
    const row = enrollments[0];
    expect(row.status).toBe("ACTIVE");
    expect(row.endedAt).toBeNull();
  });

  it("overwrites the revived row's grade/section/teacher with the learner's CURRENT pointers, not the archived ones", async () => {
    // The deliberate behaviour change (spec 4a): the archived row was pointed
    // at OLD_* when it was archived. If the pointer-overwrite were deleted,
    // this row would come back naming OLD_* — silently disagreeing with the
    // Learner row's denormalised fields.
    enrollments.push({
      id: "enrollment-archived",
      learnerId: LEARNER_ID,
      schoolYearId: YEAR_ID,
      status: "ARCHIVED",
      gradeLevelId: OLD_GRADE,
      sectionId: OLD_SECTION,
      teacherId: OLD_TEACHER,
      endedAt: new Date("2026-06-01"),
    });

    await reactivateEnrollment(makeTx(), learner());

    const row = enrollments[0];
    expect(row.gradeLevelId).toBe(CURRENT_GRADE);
    expect(row.sectionId).toBe(CURRENT_SECTION);
    expect(row.teacherId).toBe(CURRENT_TEACHER);
    // Guard against a false pass from the fixture itself.
    expect(row.gradeLevelId).not.toBe(OLD_GRADE);
    expect(row.sectionId).not.toBe(OLD_SECTION);
    expect(row.teacherId).not.toBe(OLD_TEACHER);
  });

  it("picks the most recently archived row when more than one exists for the year", async () => {
    enrollments.push(
      {
        id: "enrollment-earlier",
        learnerId: LEARNER_ID,
        schoolYearId: YEAR_ID,
        status: "ARCHIVED",
        gradeLevelId: OLD_GRADE,
        sectionId: OLD_SECTION,
        teacherId: OLD_TEACHER,
        endedAt: new Date("2026-01-01"),
      },
      {
        id: "enrollment-latest",
        learnerId: LEARNER_ID,
        schoolYearId: YEAR_ID,
        status: "ARCHIVED",
        gradeLevelId: OLD_GRADE,
        sectionId: OLD_SECTION,
        teacherId: OLD_TEACHER,
        endedAt: new Date("2026-06-01"),
      }
    );

    const result = await reactivateEnrollment(makeTx(), learner());

    expect(result.enrollmentId).toBe("enrollment-latest");
  });

  it("does not revive an archived row from a different school year", async () => {
    enrollments.push({
      id: "enrollment-other-year",
      learnerId: LEARNER_ID,
      schoolYearId: "year-2025",
      status: "ARCHIVED",
      gradeLevelId: OLD_GRADE,
      sectionId: OLD_SECTION,
      teacherId: OLD_TEACHER,
      endedAt: new Date("2025-06-01"),
    });

    const result = await reactivateEnrollment(makeTx(), learner());

    // Falls through to "created" instead, since nothing archived matches the
    // active year.
    expect(result.outcome).toBe("created");
    expect(enrollments.find((e) => e.id === "enrollment-other-year")!.status).toBe("ARCHIVED");
  });
});

describe("reactivateEnrollment — created", () => {
  it("creates a new ACTIVE row from the learner's current pointers when nothing archived exists", async () => {
    const result = await reactivateEnrollment(makeTx(), learner());

    expect(result.outcome).toBe("created");
    expect(enrollments).toHaveLength(1);
    const row = enrollments[0];
    expect(row.status).toBe("ACTIVE");
    expect(row.schoolYearId).toBe(YEAR_ID);
    expect(row.gradeLevelId).toBe(CURRENT_GRADE);
    expect(row.sectionId).toBe(CURRENT_SECTION);
    expect(row.teacherId).toBe(CURRENT_TEACHER);
    expect(result.enrollmentId).toBe(row.id);
  });

  it("creates with null section/teacher pointers when the learner currently has none (gradeLevelId is never null on Learner)", async () => {
    const result = await reactivateEnrollment(
      makeTx(),
      learner({ sectionId: null, teacherId: null })
    );

    expect(result.outcome).toBe("created");
    const row = enrollments[0];
    expect(row.gradeLevelId).toBe(CURRENT_GRADE);
    expect(row.sectionId).toBeNull();
    expect(row.teacherId).toBeNull();
  });
});
