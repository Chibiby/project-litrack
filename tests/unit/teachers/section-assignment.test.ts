import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTeacherAdvisory } from "@/lib/teachers/section-assignment";

/**
 * `setTeacherAdvisory` is the one place that changes `Section.adviserId`. This
 * file pins what happens to the LEARNERS of a section a teacher gives up.
 *
 * `add` already claimed adviser-free learners onto the new adviser (that half
 * was correct) — the bug this file guards against is the other half: `remove`
 * and `clear` used to leave `Learner.teacherId`, `Learner.aralTeacherId`, and
 * the active `Enrollment.teacherId` all still pointing at the ex-adviser, so
 * the learner kept showing up on a roster the teacher no longer had any claim
 * to. Both pointers now drop, scoped to the section(s) actually given up —
 * never to the teacher's remaining advisories, never to another teacher's
 * section, and never to a closed enrolment (history keeps who advised it).
 *
 * The fake transaction below applies each `updateMany` to in-memory rows
 * (rather than just recording call shapes) and gives `{ in: [...] }` real
 * membership semantics — a looser fake that treated array filters as "matches
 * anything" would hide exactly the section-scoping bug this file exists to
 * catch.
 */

const SCHOOL = "school-1";
const OTHER_SCHOOL = "school-2";
const TEACHER = "teacher-1";
const OTHER_TEACHER = "teacher-2";

type SectionRow = {
  id: string;
  name: string;
  schoolId: string;
  adviserId: string | null;
  deletedAt: Date | null;
  gradeLevelId: string;
};
type LearnerRow = {
  id: string;
  sectionId: string;
  schoolId: string;
  teacherId: string | null;
  aralTeacherId: string | null;
  deletedAt: Date | null;
  archivedAt: Date | null;
};
type EnrollmentRow = {
  id: string;
  sectionId: string;
  schoolId: string;
  teacherId: string | null;
  status: "ACTIVE" | "ARCHIVED";
  learnerId: string;
};

let sections: SectionRow[];
let learners: LearnerRow[];
let enrollments: EnrollmentRow[];

type Where = Record<string, unknown>;

/** Real `{ in: [...] }` / `{ not: ... }` semantics, not a blanket pass-through. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (want === undefined) return true;
    // Relation filters (`learner: { deletedAt: null, archivedAt: null }`) are
    // not exercised by anything asserted in this file — the learner/enrolment
    // rows below already carry deletedAt/archivedAt directly.
    if (key === "learner") return true;
    if (want !== null && typeof want === "object" && !(want instanceof Date)) {
      if ("in" in (want as Record<string, unknown>)) {
        return (want as { in: unknown[] }).in.includes(row[key]);
      }
      if ("not" in (want as Record<string, unknown>)) {
        return row[key] !== (want as { not: unknown }).not;
      }
      return true;
    }
    return row[key] === want;
  });
}

function updateManyOver<T extends Record<string, unknown>>(rows: () => T[]) {
  return vi.fn(async ({ where, data }: { where: Where; data: Partial<T> }) => {
    let count = 0;
    for (const row of rows()) {
      if (!matches(row, where)) continue;
      Object.assign(row, data);
      count += 1;
    }
    return { count };
  });
}

function makeTx() {
  return {
    section: {
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        sections
          .filter((s) => matches(s, where))
          .map((s) => ({ id: s.id, name: s.name, gradeLevelId: s.gradeLevelId }))
      ),
      updateMany: updateManyOver(() => sections),
    },
    learner: { updateMany: updateManyOver(() => learners) },
    enrollment: { updateMany: updateManyOver(() => enrollments) },
    teacherProfile: {
      findFirst: vi.fn(async () => ({ designation: "Teacher", advisoryMode: "MULTI_GRADE" })),
    },
    teacherSection: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ advisorySectionId: null, taughtGrades: [] })),
      update: vi.fn(async () => ({})),
    },
  };
}

beforeEach(() => {
  sections = [
    { id: "sec-released", name: "Sampaguita", schoolId: SCHOOL, adviserId: TEACHER, deletedAt: null, gradeLevelId: "grade-3" },
    { id: "sec-released-2", name: "Rosal", schoolId: SCHOOL, adviserId: TEACHER, deletedAt: null, gradeLevelId: "grade-3" },
    { id: "sec-remaining", name: "Waling-Waling", schoolId: SCHOOL, adviserId: TEACHER, deletedAt: null, gradeLevelId: "grade-4" },
    { id: "sec-other-teacher", name: "Gumamela", schoolId: SCHOOL, adviserId: OTHER_TEACHER, deletedAt: null, gradeLevelId: "grade-3" },
    { id: "sec-free", name: "Ilang-Ilang", schoolId: SCHOOL, adviserId: null, deletedAt: null, gradeLevelId: "grade-3" },
  ];
  learners = [
    { id: "l-released", sectionId: "sec-released", schoolId: SCHOOL, teacherId: TEACHER, aralTeacherId: TEACHER, deletedAt: null, archivedAt: null },
    { id: "l-released-2", sectionId: "sec-released-2", schoolId: SCHOOL, teacherId: TEACHER, aralTeacherId: TEACHER, deletedAt: null, archivedAt: null },
    { id: "l-released-other-teacher", sectionId: "sec-released", schoolId: SCHOOL, teacherId: OTHER_TEACHER, aralTeacherId: OTHER_TEACHER, deletedAt: null, archivedAt: null },
    { id: "l-remaining", sectionId: "sec-remaining", schoolId: SCHOOL, teacherId: TEACHER, aralTeacherId: TEACHER, deletedAt: null, archivedAt: null },
    { id: "l-other-teacher-section", sectionId: "sec-other-teacher", schoolId: SCHOOL, teacherId: OTHER_TEACHER, aralTeacherId: OTHER_TEACHER, deletedAt: null, archivedAt: null },
    { id: "l-free", sectionId: "sec-free", schoolId: SCHOOL, teacherId: null, aralTeacherId: null, deletedAt: null, archivedAt: null },
  ];
  enrollments = [
    { id: "e-released-active", sectionId: "sec-released", schoolId: SCHOOL, teacherId: TEACHER, status: "ACTIVE", learnerId: "l-released" },
    { id: "e-released-archived", sectionId: "sec-released", schoolId: SCHOOL, teacherId: TEACHER, status: "ARCHIVED", learnerId: "l-released" },
    { id: "e-released-2-active", sectionId: "sec-released-2", schoolId: SCHOOL, teacherId: TEACHER, status: "ACTIVE", learnerId: "l-released-2" },
    { id: "e-remaining-active", sectionId: "sec-remaining", schoolId: SCHOOL, teacherId: TEACHER, status: "ACTIVE", learnerId: "l-remaining" },
    { id: "e-other-teacher-active", sectionId: "sec-other-teacher", schoolId: SCHOOL, teacherId: OTHER_TEACHER, status: "ACTIVE", learnerId: "l-other-teacher-section" },
  ];
});

describe("setTeacherAdvisory — op: remove", () => {
  it("releases the given-up section's learners: both teacher pointers null", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "remove", sectionId: "sec-released" },
    });

    const l = learners.find((x) => x.id === "l-released")!;
    expect(l.teacherId).toBeNull();
    expect(l.aralTeacherId).toBeNull();
  });

  it("does not touch a learner in that section held by a different teacher", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "remove", sectionId: "sec-released" },
    });

    const l = learners.find((x) => x.id === "l-released-other-teacher")!;
    expect(l.teacherId).toBe(OTHER_TEACHER);
    expect(l.aralTeacherId).toBe(OTHER_TEACHER);
  });

  it("does not touch a learner of the teacher's remaining section", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "remove", sectionId: "sec-released" },
    });

    const l = learners.find((x) => x.id === "l-remaining")!;
    expect(l.teacherId).toBe(TEACHER);
    expect(l.aralTeacherId).toBe(TEACHER);
    expect(sections.find((s) => s.id === "sec-remaining")?.adviserId).toBe(TEACHER);
  });

  it("releases the active enrolment but not an ended one", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "remove", sectionId: "sec-released" },
    });

    expect(enrollments.find((e) => e.id === "e-released-active")?.teacherId).toBeNull();
    expect(enrollments.find((e) => e.id === "e-released-archived")?.teacherId).toBe(TEACHER);
  });

  it("cannot release someone else's section, or its learners, via a stale form", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "remove", sectionId: "sec-other-teacher" },
    });

    expect(sections.find((s) => s.id === "sec-other-teacher")?.adviserId).toBe(OTHER_TEACHER);
    const l = learners.find((x) => x.id === "l-other-teacher-section")!;
    expect(l.teacherId).toBe(OTHER_TEACHER);
    expect(l.aralTeacherId).toBe(OTHER_TEACHER);
  });

  it("never reaches into another school", async () => {
    sections.push({ id: "sec-x", name: "Cross", schoolId: OTHER_SCHOOL, adviserId: TEACHER, deletedAt: null, gradeLevelId: "g" });
    learners.push({ id: "l-x", sectionId: "sec-x", schoolId: OTHER_SCHOOL, teacherId: TEACHER, aralTeacherId: TEACHER, deletedAt: null, archivedAt: null });

    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "remove", sectionId: "sec-x" },
    });

    expect(sections.find((s) => s.id === "sec-x")?.adviserId).toBe(TEACHER);
    const l = learners.find((x) => x.id === "l-x")!;
    expect(l.teacherId).toBe(TEACHER);
    expect(l.aralTeacherId).toBe(TEACHER);
  });
});

describe("setTeacherAdvisory — op: clear", () => {
  it("releases every held section's learners: both teacher pointers null", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "clear" },
    });

    for (const id of ["l-released", "l-released-2", "l-remaining"]) {
      const l = learners.find((x) => x.id === id)!;
      expect(l.teacherId).toBeNull();
      expect(l.aralTeacherId).toBeNull();
    }
  });

  it("does not touch a learner held by a different teacher", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "clear" },
    });

    for (const id of ["l-released-other-teacher", "l-other-teacher-section"]) {
      const l = learners.find((x) => x.id === id)!;
      expect(l.teacherId).toBe(OTHER_TEACHER);
      expect(l.aralTeacherId).toBe(OTHER_TEACHER);
    }
    expect(sections.find((s) => s.id === "sec-other-teacher")?.adviserId).toBe(OTHER_TEACHER);
  });

  it("releases every active enrolment across the held sections, but not an ended one", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "clear" },
    });

    expect(enrollments.find((e) => e.id === "e-released-active")?.teacherId).toBeNull();
    expect(enrollments.find((e) => e.id === "e-released-2-active")?.teacherId).toBeNull();
    expect(enrollments.find((e) => e.id === "e-remaining-active")?.teacherId).toBeNull();
    expect(enrollments.find((e) => e.id === "e-released-archived")?.teacherId).toBe(TEACHER);
    expect(enrollments.find((e) => e.id === "e-other-teacher-active")?.teacherId).toBe(OTHER_TEACHER);
  });

  it("never reaches into another school", async () => {
    sections.push({ id: "sec-x", name: "Cross", schoolId: OTHER_SCHOOL, adviserId: TEACHER, deletedAt: null, gradeLevelId: "g" });
    learners.push({ id: "l-x", sectionId: "sec-x", schoolId: OTHER_SCHOOL, teacherId: TEACHER, aralTeacherId: TEACHER, deletedAt: null, archivedAt: null });

    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "clear" },
    });

    const l = learners.find((x) => x.id === "l-x")!;
    expect(l.teacherId).toBe(TEACHER);
    expect(l.aralTeacherId).toBe(TEACHER);
  });
});

describe("setTeacherAdvisory — op: add (regression guard)", () => {
  beforeEach(() => {
    // Isolate `add` from the cap: the shared fixture already gives TEACHER
    // three live advisories (used by the remove/clear tests above), which
    // would trip `AdvisoryCapError` here. These tests are about the learner
    // hand-off, not the cap (that is `advisory-cap.test.ts`'s job).
    for (const s of sections) {
      if (s.adviserId === TEACHER) s.adviserId = null;
    }
  });

  it("still claims an adviser-free section's adviser-free learners", async () => {
    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "add", sectionId: "sec-free" },
    });

    expect(sections.find((s) => s.id === "sec-free")?.adviserId).toBe(TEACHER);
    expect(learners.find((l) => l.id === "l-free")?.teacherId).toBe(TEACHER);
  });

  it("does not pull across a learner another teacher still advises", async () => {
    // sec-other-teacher already has an adviser, so `add` refuses (P2002 guard);
    // exercise the "learner already has a teacher" guard on a free section instead.
    learners.push({
      id: "l-free-2",
      sectionId: "sec-free",
      schoolId: SCHOOL,
      teacherId: OTHER_TEACHER,
      aralTeacherId: OTHER_TEACHER,
      deletedAt: null,
      archivedAt: null,
    });

    await setTeacherAdvisory(makeTx() as never, {
      teacherId: TEACHER,
      schoolId: SCHOOL,
      change: { op: "add", sectionId: "sec-free" },
    });

    const untouched = learners.find((l) => l.id === "l-free-2")!;
    expect(untouched.teacherId).toBe(OTHER_TEACHER);
    expect(untouched.aralTeacherId).toBe(OTHER_TEACHER);
  });
});
