import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  managedTeacherSelect,
  teacherRosterFilterWhere,
  toManagedRow,
  type ManagedTeacher,
} from "@/lib/teachers/roster";

/**
 * §6 of the ten concerns. `managedTeacherSelect` pulled `advisorySection` with
 * no soft-delete filter, so a teacher whose section had been archived still
 * rendered on the School Head's teachers page as advising it. The page showed an
 * assignment that no longer exists, and a teacher who is in fact free read as
 * assigned — the one surface in the repo where the two disagreed. Every other
 * reader already guards it: both transfer pages and `teacherAdvisoryGradeScope`
 * all filter `deletedAt: null`.
 *
 * Wave A of multi-advisory then turned the relation into a LIST, which does
 * accept a `where` — so the filter moved out of `toManagedRow` and into the
 * query, and the mapper's job shrank to shaping rows. The rule this file guards
 * is unchanged; only the place it is enforced moved, and the last test says so.
 *
 * The rest of the file is the multi-advisory half: a teacher may hold up to
 * three, `assignments` is a list rather than a nullable object, and empty is how
 * "advises nothing" is spelled.
 */

const BASE = {
  id: "teacher-marivic",
  fullName: "Marivic Cruz",
  email: "marivic@example.test",
  profileCompleted: true,
  approvedAt: new Date(2026, 5, 1),
  advisorySections: [],
  _count: { managedLearners: 12, aralLearners: 3 },
} satisfies ManagedTeacher;

function section(over: Partial<{ id: string; name: string }> = {}) {
  return {
    id: "section-sampaguita",
    name: "Sampaguita",
    gradeLevel: { type: "G4" as const },
    ...over,
  };
}

describe("toManagedRow — advisory sections", () => {
  it("reports a live advisory section as an assignment", () => {
    const row = toManagedRow({ ...BASE, advisorySections: [section()] });

    expect(row.assignments).toEqual([
      {
        sectionId: "section-sampaguita",
        gradeName: "Grade 4",
        sectionName: "Sampaguita",
      },
    ]);
  });

  it("reports all three of a multi-advisory teacher, in query order", () => {
    const row = toManagedRow({
      ...BASE,
      advisorySections: [
        section(),
        section({ id: "section-rosal", name: "Rosal" }),
        section({ id: "section-ilang", name: "Ilang-Ilang" }),
      ],
    });

    expect(row.assignments.map((a) => a.sectionName)).toEqual([
      "Sampaguita",
      "Rosal",
      "Ilang-Ilang",
    ]);
  });

  it("reports a teacher with no live sections as unassigned", () => {
    // Empty, never null: one shape, so no caller has to handle both.
    expect(toManagedRow(BASE).assignments).toEqual([]);
  });

  it("keeps every other column, so the row is not otherwise disturbed", () => {
    const row = toManagedRow({ ...BASE, advisorySections: [section()] });

    expect(row).toMatchObject({
      id: "teacher-marivic",
      fullName: "Marivic Cruz",
      learnerCount: 12,
      aralLearnerCount: 3,
    });
  });

  /**
   * §6 was fixed by filtering inside `toManagedRow`, because Prisma has no
   * `where` inside a `select` for a to-one relation. `advisorySections` is a
   * LIST relation, which does accept one, so the filter moved into the query and
   * an archived section never reaches the mapper at all. The rule did not
   * change; the place it is enforced did.
   */
  it("excludes archived sections in the query, not after it", () => {
    const advisory = managedTeacherSelect.advisorySections;
    expect(advisory).toBeTruthy();
    expect((advisory as { where: Record<string, unknown> }).where).toEqual({
      deletedAt: null,
    });
  });
});

describe("teacherRosterFilterWhere", () => {
  it("uses the shared volunteer designation", () => {
    expect(teacherRosterFilterWhere("non-deped-aral-volunteer")).toEqual({
      teacherProfile: { is: { designation: "Non-DepEd ARAL Volunteer" } },
    });
  });

  it("distinguishes floating from teachers with a live advisory", () => {
    expect(teacherRosterFilterWhere("floating")).toEqual({
      advisorySections: { none: { deletedAt: null } },
    });
    expect(teacherRosterFilterWhere("with-advisory")).toEqual({
      advisorySections: { some: { deletedAt: null } },
    });
  });

  it("filters the exact Teacher designation", () => {
    expect(teacherRosterFilterWhere("teacher")).toEqual({
      teacherProfile: { is: { designation: "Teacher" } },
    });
  });
});


describe("the other advisory-label readers guard soft deletes too", () => {
  const SRC = path.resolve(__dirname, "../../src");

  it.each([
    ["lib/actions/global-search.ts", "the teacher search subtitle"],
    ["lib/admin/school-detail.ts", "the admin school-detail teacher list"],
  ])("%s filters archived sections in the query", (file) => {
    const text = readFileSync(path.join(SRC, file), "utf8");
    // The filter moved INTO the query when the relation became a list, so the
    // shape to look for changed with it. What is guarded has not: an archived
    // section must not reach the label these files render.
    expect(text).toMatch(/advisorySections: \{\s*where: \{ deletedAt: null \}/);
    // And nothing consults the dying to-one pointer any more.
    expect(text).not.toMatch(/\bt\.advisorySection\b/);
  });
});
