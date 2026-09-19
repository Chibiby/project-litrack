import { describe, it, expect } from "vitest";
import {
  buildSchoolHeadAttention,
  type SchoolHeadOverview,
  type SchoolHeadAttentionHrefs,
} from "@/lib/dashboard/school-head-overview";

/**
 * `buildSchoolHeadAttention` is a pure function — plain facts in, the "Needs
 * your attention" list out (`docs/school-head-ui-rework.md` section 3.6). No
 * database, no cache, so every case below is checked against the exact list
 * the function returns, not a rendered component.
 */

const HREFS: SchoolHeadAttentionHrefs = {
  teachers: "/school-head/teachers/pending",
  gradeLevels: "/school-head/school",
  years: "/school-head/school/years",
  profiling: "/school-head/profiling",
};

/** A fully set-up school: nothing should appear in the attention list. */
function overview(over: Partial<SchoolHeadOverview> = {}): SchoolHeadOverview {
  return {
    learnerCount: 120,
    teacherCount: 8,
    gradeCount: 6,
    sectionCount: 12,
    aralCount: 40,
    activeYear: { label: "SY 2026-2027" },
    setupTasks: [],
    pendingTeacherCount: 0,
    ipLearners: 5,
    totalLearners: 120,
    ipPercent: "4%",
    learnersPerTeacher: "15",
    activeTeachers: 8,
    adviserlessSections: [],
    todayKey: "2026-09-19",
    ...over,
  };
}

describe("buildSchoolHeadAttention — zero pending teachers", () => {
  it("renders no approvals row when nothing is pending", () => {
    // Adviserless sections keep the list non-empty, so a passing test cannot
    // be explained by the "otherwise empty" All-clear fallback swallowing the
    // absent approvals row.
    const items = buildSchoolHeadAttention(
      overview({
        pendingTeacherCount: 0,
        adviserlessSections: [
          { id: "sec-1", gradeLabel: "Grade 3", sectionName: "Mabini", learnerCount: 10 },
        ],
      }),
      HREFS
    );

    expect(items.some((i) => i.id === "approvals")).toBe(false);
    expect(JSON.stringify(items)).not.toContain("waiting");
  });
});

describe("buildSchoolHeadAttention — N pending teachers", () => {
  it("renders one approvals row naming the exact count, singular", () => {
    const items = buildSchoolHeadAttention(overview({ pendingTeacherCount: 1 }), HREFS);

    const approvals = items.find((i) => i.id === "approvals");
    expect(approvals).toBeDefined();
    expect(approvals?.badge).toBe("1 waiting");
    expect(approvals?.href).toBe(HREFS.teachers);
    expect(approvals?.tone).toBe("amber");
    expect(approvals?.label).toBe("Approve teacher registrations");
  });

  it("pluralizes the badge for more than one", () => {
    const items = buildSchoolHeadAttention(overview({ pendingTeacherCount: 5 }), HREFS);

    expect(items.find((i) => i.id === "approvals")?.badge).toBe("5 waiting");
  });
});

describe("buildSchoolHeadAttention — adviserless sections", () => {
  it("renders one adviserless row naming the section count and points at grade levels", () => {
    const items = buildSchoolHeadAttention(
      overview({
        adviserlessSections: [
          { id: "sec-1", gradeLabel: "Grade 1", sectionName: "Rizal", learnerCount: 20 },
          { id: "sec-2", gradeLabel: "Grade 2", sectionName: "Bonifacio", learnerCount: 18 },
        ],
      }),
      HREFS
    );

    const adviserless = items.find((i) => i.id === "adviserless");
    expect(adviserless).toBeDefined();
    expect(adviserless?.badge).toBe("2 sections");
    expect(adviserless?.detail).toContain("2 sections have learners but no adviser");
    expect(adviserless?.href).toBe(HREFS.gradeLevels);
    expect(adviserless?.tone).toBe("amber");
  });

  it("does not render the row when every section has an adviser", () => {
    const items = buildSchoolHeadAttention(overview({ adviserlessSections: [] }), HREFS);
    expect(items.some((i) => i.id === "adviserless")).toBe(false);
  });
});

describe("buildSchoolHeadAttention — no active school year", () => {
  it("renders the year row pointing at School years, badged Not set", () => {
    const items = buildSchoolHeadAttention(overview({ activeYear: null }), HREFS);

    const year = items.find((i) => i.id === "year");
    expect(year).toBeDefined();
    expect(year?.badge).toBe("Not set");
    expect(year?.href).toBe(HREFS.years);
    expect(year?.tone).toBe("amber");
  });

  it("does not render the row when an active year exists", () => {
    const items = buildSchoolHeadAttention(
      overview({ activeYear: { label: "SY 2026-2027" } }),
      HREFS
    );
    expect(items.some((i) => i.id === "year")).toBe(false);
  });
});

describe("buildSchoolHeadAttention — school-year nudge de-duplication", () => {
  it("drops the matching setupTasks entry so the year nudge shows exactly once", () => {
    const items = buildSchoolHeadAttention(
      overview({
        activeYear: null,
        setupTasks: [
          { id: "year", label: "Set an active school year", href: HREFS.years },
          { id: "grades", label: "Create grade levels", href: HREFS.gradeLevels },
        ],
      }),
      HREFS
    );

    // Exactly one row about the missing year: the dedicated `year` row, not a
    // second `setup:year` row from the raw setupTasks list.
    const yearRows = items.filter((i) => i.id === "year" || i.id === "setup:year");
    expect(yearRows).toHaveLength(1);
    expect(yearRows[0].id).toBe("year");

    // The unrelated setup task still comes through untouched.
    expect(items.some((i) => i.id === "setup:grades")).toBe(true);
  });
});

describe("buildSchoolHeadAttention — the empty case (All clear)", () => {
  it("renders exactly one muted All-clear row when nothing needs attention", () => {
    const items = buildSchoolHeadAttention(overview(), HREFS);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "allclear",
      badge: "All clear",
      tone: "muted",
    });
  });

  it("does not add All-clear once any real item is present", () => {
    const items = buildSchoolHeadAttention(overview({ pendingTeacherCount: 1 }), HREFS);
    expect(items.some((i) => i.id === "allclear")).toBe(false);
  });
});

describe("buildSchoolHeadAttention — severity order", () => {
  it("ranks no-active-year above adviserless sections above pending approvals", () => {
    // All three trigger at once, in an overview built with the *opposite*
    // insertion order (approvals field first, year last) so a passing test
    // cannot be explained by object key order leaking into array order.
    const items = buildSchoolHeadAttention(
      overview({
        pendingTeacherCount: 2,
        adviserlessSections: [
          { id: "sec-1", gradeLabel: "Grade 4", sectionName: "Luna", learnerCount: 9 },
        ],
        activeYear: null,
      }),
      HREFS
    );

    const ids = items.map((i) => i.id);
    expect(ids.indexOf("year")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("adviserless")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("approvals")).toBeGreaterThanOrEqual(0);

    // The operator-specified rank, checked pairwise so a reordering of any
    // two adjacent items fails this test.
    expect(ids.indexOf("year")).toBeLessThan(ids.indexOf("adviserless"));
    expect(ids.indexOf("adviserless")).toBeLessThan(ids.indexOf("approvals"));

    // And exactly this order, front to back.
    expect(ids.slice(0, 3)).toEqual(["year", "adviserless", "approvals"]);
  });

  it("places remaining setupTasks after the three severity rows", () => {
    const items = buildSchoolHeadAttention(
      overview({
        pendingTeacherCount: 1,
        activeYear: null,
        setupTasks: [
          { id: "year", label: "Set an active school year", href: HREFS.years },
          { id: "profile", label: "Complete School Head profiling", href: HREFS.profiling },
        ],
      }),
      HREFS
    );

    const ids = items.map((i) => i.id);
    expect(ids).toEqual(["year", "approvals", "setup:profile"]);
  });
});
