import { beforeEach, describe, expect, it, vi } from "vitest";
import { releaseTeacherAdvisory } from "@/lib/teachers/release-advisory";

/**
 * `releaseTeacherAdvisory` is what removing a teacher does to everything they
 * advised: their sections go back to Unassigned, and their advisory learners —
 * on the learner row AND on the active enrolment, which must agree — are left
 * with no adviser until the School Head gives the section a new one.
 *
 * The fake transaction applies each `updateMany` to in-memory rows rather than
 * recording calls, so the assertions are about the end state. It also honours
 * `schoolId` in every `where`: the helper's tenant scope is the property most
 * worth pinning, and a fake that ignored it would pass a cross-tenant write.
 */

const SCHOOL = "school-1";
const OTHER_SCHOOL = "school-2";
const TEACHER = "teacher-1";
const OTHER_TEACHER = "teacher-2";

type SectionRow = { id: string; schoolId: string; adviserId: string | null; deletedAt: Date | null; gradeLevelId: string };
type LearnerRow = { id: string; schoolId: string; teacherId: string | null };
type EnrollmentRow = { id: string; schoolId: string; teacherId: string | null; status: "ACTIVE" | "ARCHIVED" };

let sections: SectionRow[];
let learners: LearnerRow[];
let enrollments: EnrollmentRow[];
let teacherSectionDeletes: unknown[];
let userUpdates: unknown[];

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (want === undefined) return true;
    if (want && typeof want === "object" && !(want instanceof Date)) {
      // Relation filters are out of scope for this fake; none are used here.
      return true;
    }
    return row[key] === want;
  });
}

function makeTx() {
  const updateManyOver =
    <T extends Record<string, unknown>>(rows: () => T[]) =>
    vi.fn(async ({ where, data }: { where: Where; data: Partial<T> }) => {
      let count = 0;
      for (const row of rows()) {
        if (!matches(row, where)) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    });

  return {
    section: {
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        sections
          .filter((s) => matches(s, where))
          .map((s) => ({ id: s.id, name: s.id, gradeLevelId: s.gradeLevelId }))
      ),
      updateMany: updateManyOver(() => sections),
    },
    learner: { updateMany: updateManyOver(() => learners) },
    enrollment: { updateMany: updateManyOver(() => enrollments) },
    teacherSection: {
      deleteMany: vi.fn(async (args: unknown) => {
        teacherSectionDeletes.push(args);
        return { count: 0 };
      }),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        advisorySectionId: "sec-a",
        taughtGrades: [{ id: "grade-3" }],
      })),
      update: vi.fn(async (args: unknown) => {
        userUpdates.push(args);
        return {};
      }),
    },
  };
}

beforeEach(() => {
  sections = [
    { id: "sec-a", schoolId: SCHOOL, adviserId: TEACHER, deletedAt: null, gradeLevelId: "grade-3" },
    { id: "sec-b", schoolId: SCHOOL, adviserId: TEACHER, deletedAt: null, gradeLevelId: "grade-3" },
    { id: "sec-other", schoolId: SCHOOL, adviserId: OTHER_TEACHER, deletedAt: null, gradeLevelId: "grade-3" },
  ];
  learners = [
    { id: "l1", schoolId: SCHOOL, teacherId: TEACHER },
    { id: "l2", schoolId: SCHOOL, teacherId: TEACHER },
    { id: "l3", schoolId: SCHOOL, teacherId: OTHER_TEACHER },
  ];
  enrollments = [
    { id: "e1", schoolId: SCHOOL, teacherId: TEACHER, status: "ACTIVE" },
    { id: "e1-old", schoolId: SCHOOL, teacherId: TEACHER, status: "ARCHIVED" },
    { id: "e3", schoolId: SCHOOL, teacherId: OTHER_TEACHER, status: "ACTIVE" },
  ];
  teacherSectionDeletes = [];
  userUpdates = [];
});

describe("releaseTeacherAdvisory", () => {
  it("returns every section they advised to Unassigned", async () => {
    const released = await releaseTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
    });

    expect(released.sectionIds).toEqual(["sec-a", "sec-b"]);
    expect(sections.find((s) => s.id === "sec-a")?.adviserId).toBeNull();
    expect(sections.find((s) => s.id === "sec-b")?.adviserId).toBeNull();
    // Another teacher's section is not theirs to free.
    expect(sections.find((s) => s.id === "sec-other")?.adviserId).toBe(OTHER_TEACHER);
  });

  it("leaves their advisory learners with no adviser, and counts them", async () => {
    const released = await releaseTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
    });

    expect(released.learnerCount).toBe(2);
    expect(learners.find((l) => l.id === "l1")?.teacherId).toBeNull();
    expect(learners.find((l) => l.id === "l2")?.teacherId).toBeNull();
    expect(learners.find((l) => l.id === "l3")?.teacherId).toBe(OTHER_TEACHER);
  });

  it("clears the adviser on the active enrolment too, so it agrees with the learner row", async () => {
    await releaseTeacherAdvisory(makeTx() as never, { teacherId: TEACHER, schoolId: SCHOOL });

    expect(enrollments.find((e) => e.id === "e1")?.teacherId).toBeNull();
    // A closed enrolment is history: it keeps who advised the learner that year.
    expect(enrollments.find((e) => e.id === "e1-old")?.teacherId).toBe(TEACHER);
    expect(enrollments.find((e) => e.id === "e3")?.teacherId).toBe(OTHER_TEACHER);
  });

  it("clears the legacy advisory mirrors along with the authoritative column", async () => {
    await releaseTeacherAdvisory(makeTx() as never, { teacherId: TEACHER, schoolId: SCHOOL });

    expect(teacherSectionDeletes).toEqual([{ where: { teacherId: TEACHER } }]);
    expect(userUpdates[0]).toMatchObject({
      where: { id: TEACHER },
      data: { advisorySectionId: null, taughtGrades: { disconnect: [{ id: "grade-3" }] } },
    });
  });

  it("never reaches into another school", async () => {
    sections.push({ id: "sec-x", schoolId: OTHER_SCHOOL, adviserId: TEACHER, deletedAt: null, gradeLevelId: "g" });
    learners.push({ id: "lx", schoolId: OTHER_SCHOOL, teacherId: TEACHER });
    enrollments.push({ id: "ex", schoolId: OTHER_SCHOOL, teacherId: TEACHER, status: "ACTIVE" });

    const released = await releaseTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
    });

    expect(released.sectionIds).not.toContain("sec-x");
    expect(sections.find((s) => s.id === "sec-x")?.adviserId).toBe(TEACHER);
    expect(learners.find((l) => l.id === "lx")?.teacherId).toBe(TEACHER);
    expect(enrollments.find((e) => e.id === "ex")?.teacherId).toBe(TEACHER);
  });

  it("is harmless for a teacher who advised nothing", async () => {
    const released = await releaseTeacherAdvisory(makeTx() as never, {
      teacherId: "nobody",
      schoolId: SCHOOL,
    });

    expect(released).toEqual({ sectionIds: [], learnerCount: 0 });
    expect(sections.every((s) => s.adviserId !== null)).toBe(true);
  });
});
