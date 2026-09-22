import { describe, expect, it } from "vitest";
import {
  compareTeacherRows,
  LEARNER_SORT_OPTIONS,
  TEACHER_SORTS,
} from "@/components/admin/school-detail-view";
import type { TeacherRow } from "@/lib/admin/school-detail";

/**
 * `school-detail-view.tsx`'s client-side "Sort by" for the (unpaginated)
 * teachers roster. `school-detail.ts` is `server-only`, so this registry and
 * comparator live in the view instead — see the file-header comment next to
 * `LEARNER_SORT_OPTIONS` for why, and why that option list is checked here
 * against the server's `SCHOOL_LEARNER_SORTS` for drift.
 */

function teacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: "t1",
    fullName: "Juana Cruz",
    listingName: "Cruz, Juana",
    firstName: "Juana",
    lastName: "Cruz",
    email: "juana@school.local",
    isActive: true,
    approvalStatus: null,
    advisorySection: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("compareTeacherRows — alphabetical", () => {
  it("orders by lastName then firstName, not fullName/listingName", () => {
    const a = teacher({ id: "a", fullName: "Zed Aquino", lastName: "Aquino", firstName: "Zed" });
    const b = teacher({ id: "b", fullName: "Ana Zapata", lastName: "Zapata", firstName: "Ana" });
    // fullName would put "Ana Zapata" before "Zed Aquino"; lastName puts
    // Aquino (a) before Zapata (b) — the opposite order, which is the point.
    expect(compareTeacherRows("alphabetical", a, b)).toBeLessThan(0);
    expect(compareTeacherRows("alphabetical", b, a)).toBeGreaterThan(0);
  });

  it("tiebreaks on firstName when lastName matches", () => {
    const a = teacher({ id: "a", lastName: "Cruz", firstName: "Ana" });
    const b = teacher({ id: "b", lastName: "Cruz", firstName: "Bea" });
    expect(compareTeacherRows("alphabetical", a, b)).toBeLessThan(0);
  });

  it("treats surnames differing only by accent or case as equal, via compareNames", () => {
    // EQUALITY is the assertion that discriminates, not adjacency. Node's
    // default collation already sorts "Ñ" next to "N", so an adjacency check
    // passes against raw `localeCompare` too and proves nothing — an earlier
    // version of this test did exactly that. `compareNames` uses
    // `sensitivity: "base"`, under which these surnames compare EQUAL and the
    // row order falls through to the firstName tiebreaker; raw
    // `localeCompare` returns non-zero and would order them by accent.
    const nunez = teacher({ id: "a", lastName: "Nunez", firstName: "Ana" });
    const enye = teacher({ id: "b", lastName: "Ñuñez", firstName: "Ana" });

    expect(compareTeacherRows("alphabetical", nunez, enye)).toBe(0);
    expect(compareTeacherRows("alphabetical", enye, nunez)).toBe(0);

    // And the same for case, which `sensitivity: "base"` also folds.
    const upper = teacher({ id: "c", lastName: "CRUZ", firstName: "Ana" });
    const lower = teacher({ id: "d", lastName: "cruz", firstName: "Ana" });
    expect(compareTeacherRows("alphabetical", upper, lower)).toBe(0);
  });
});

describe("compareTeacherRows — section", () => {
  it("orders by advisorySection, tiebreaking alphabetically", () => {
    const a = teacher({ id: "a", lastName: "Zamora", advisorySection: "Aster" });
    const b = teacher({ id: "b", lastName: "Aquino", advisorySection: "Begonia" });
    expect(compareTeacherRows("section", a, b)).toBeLessThan(0);
  });

  it("a null section sorts consistently against a named one", () => {
    const a = teacher({ id: "a", lastName: "Aquino", advisorySection: null });
    const b = teacher({ id: "b", lastName: "Zamora", advisorySection: "Aster" });
    expect(compareTeacherRows("section", a, b)).toBeLessThan(0);
  });
});

describe("compareTeacherRows — date-added", () => {
  it("orders newest first", () => {
    const older = teacher({ id: "a", createdAt: "2023-01-01T00:00:00.000Z" });
    const newer = teacher({ id: "b", createdAt: "2024-01-01T00:00:00.000Z" });
    expect(compareTeacherRows("date-added", newer, older)).toBeLessThan(0);
    expect(compareTeacherRows("date-added", older, newer)).toBeGreaterThan(0);
  });
});

describe("client teachers sort — no Grade level option", () => {
  it("has no grade-level value: a teacher may advise sections across more than one grade", () => {
    // Widened to `string` on purpose: the union type already excludes
    // "grade-level", so a typed comparison is a compile error rather than a
    // runtime check. The assertion still earns its place — it fails if
    // someone later adds the option to the registry.
    const values: string[] = TEACHER_SORTS.options.map((o) => o.value);
    expect(values.includes("grade-level")).toBe(false);
    expect(TEACHER_SORTS.options.map((o) => o.value)).toEqual([
      "alphabetical",
      "section",
      "date-added",
    ]);
  });
});

describe("client learner sort options — parity with the server registry", () => {
  it("matches SCHOOL_LEARNER_SORTS.options exactly, so the dropdown never drifts from what the server actually sorts by", async () => {
    const { SCHOOL_LEARNER_SORTS } = await import("@/lib/admin/school-detail");
    // Both sides compared directly, not against a hardcoded literal: this
    // catches a removed option, a reordering, or a relabelled entry on
    // either side, not just an added/typo'd `value` (which `satisfies`
    // already catches at compile time).
    expect(LEARNER_SORT_OPTIONS).toEqual(SCHOOL_LEARNER_SORTS.options);
    expect(SCHOOL_LEARNER_SORTS.fallback).toBe("alphabetical");
  });
});
