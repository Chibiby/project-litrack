import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  managedTeacherSelect,
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
 * Prisma has no `where` inside a `select` for a to-one relation, so the filter
 * cannot live in the select the way the `_count`s' does. It lives in
 * `toManagedRow` instead, which is the single place every roster route maps
 * through — one rule, applied once, rather than at each call site.
 */

const BASE = {
  id: "teacher-marivic",
  fullName: "Marivic Cruz",
  email: "marivic@example.test",
  profileCompleted: true,
  approvedAt: new Date(2026, 5, 1),
  advisorySection: null,
  _count: { managedLearners: 12, aralLearners: 3 },
} satisfies ManagedTeacher;

function section(over: Partial<{ deletedAt: Date | null }> = {}) {
  return {
    id: "section-sampaguita",
    name: "Sampaguita",
    deletedAt: null,
    gradeLevel: { type: "G4" as const },
    ...over,
  };
}

describe("toManagedRow — archived advisory sections", () => {
  it("reports a live advisory section as the assignment", () => {
    const row = toManagedRow({ ...BASE, advisorySection: section() });

    expect(row.assignment).toEqual({
      sectionId: "section-sampaguita",
      gradeName: "Grade 4",
      sectionName: "Sampaguita",
    });
  });

  /** The regression: this used to render as "Grade 4 · Sampaguita". */
  it("reports a teacher whose only section is archived as unassigned", () => {
    const row = toManagedRow({
      ...BASE,
      advisorySection: section({ deletedAt: new Date(2026, 8, 1) }),
    });

    expect(row.assignment).toBeNull();
  });

  it("reports a teacher with no section at all as unassigned", () => {
    expect(toManagedRow(BASE).assignment).toBeNull();
  });

  it("keeps every other column, so the row is not otherwise disturbed", () => {
    const row = toManagedRow({
      ...BASE,
      advisorySection: section({ deletedAt: new Date(2026, 8, 1) }),
    });

    expect(row).toMatchObject({
      id: "teacher-marivic",
      fullName: "Marivic Cruz",
      learnerCount: 12,
      aralLearnerCount: 3,
    });
  });

  it("selects the column the filter reads", () => {
    // Dropping `deletedAt` from the select would make the check above silently
    // pass on `undefined` for every teacher, restoring the bug.
    const advisory = managedTeacherSelect.advisorySection;
    expect(advisory).toBeTruthy();
    expect(
      (advisory as { select: Record<string, unknown> }).select.deletedAt
    ).toBe(true);
  });
});

/**
 * The same rule, on the two other surfaces that render an advisory label.
 *
 * §6 named the teachers page as "the one that was missed". It was not quite the
 * only one: global search's teacher subtitle and the admin school-detail teacher
 * list both read `advisorySection.name` with no soft-delete filter either. They
 * are display-only — neither grants access — but they told the same untruth, and
 * a School Head reading "Adviser · Sampaguita" in search while the teachers page
 * says Unassigned has no way to know which is right.
 *
 * A source check rather than a behavioural one: both live inside larger Prisma
 * reads whose harnesses would cost more than the assertion is worth, and the
 * failure mode being guarded is a dropped filter, which is visible in the text.
 */
describe("the other advisory-label readers guard soft deletes too", () => {
  const SRC = path.resolve(__dirname, "../../src");

  it.each([
    ["lib/actions/global-search.ts", "the teacher search subtitle"],
    ["lib/admin/school-detail.ts", "the admin school-detail teacher list"],
  ])("%s selects and checks deletedAt", (file) => {
    const text = readFileSync(path.join(SRC, file), "utf8");
    // Selected...
    expect(text).toMatch(/advisorySection: \{ select: \{[^}]*deletedAt: true/);
    // ...and actually consulted, not merely fetched.
    expect(text).toMatch(/advisorySection\.deletedAt === null/);
  });
});
