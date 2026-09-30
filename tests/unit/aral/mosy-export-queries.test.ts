import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `loadMosyExport` vs `loadMosyPage`: same filters must produce the same
 * learner `where` (both go through `mosyListWhere`), the export is not
 * paginated, and it is capped at MOSY_EXPORT_MAX_ROWS. Prisma is faked; the
 * where builders (`mosyLearnerScope`, `mosyStatusWhere`) are real.
 */

const count = vi.fn();
const learnerFindMany = vi.fn();
const gradeFindFirst = vi.fn();
const sectionFindFirst = vi.fn();
const sectionFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      count: (a: unknown) => count(a),
      findMany: (a: unknown) => learnerFindMany(a),
    },
    gradeLevel: { findFirst: (a: unknown) => gradeFindFirst(a) },
    section: {
      findFirst: (a: unknown) => sectionFindFirst(a),
      findMany: (a: unknown) => sectionFindMany(a),
    },
  },
}));

const { loadMosyExport, loadMosyPage, MOSY_EXPORT_MAX_ROWS } = await import("@/lib/aral/mosy-queries");

const SCHOOL = "school-1";
const YEAR = { id: "year-1", startDateKey: "2026-06-08" };

const base = {
  schoolId: SCHOOL,
  schoolYear: YEAR,
  teacherId: "tutor-1" as string | null,
  q: "cruz",
  grade: "grade-4",
  section: "section-a",
  status: "for_decision" as const,
};

function learner(i: number) {
  return {
    id: `l-${i}`,
    fullName: `Learner ${i}`,
    firstName: `First${i}`,
    middleName: null,
    lastName: `Last${i}`,
    gradeLevelId: "grade-4",
    isAralLearner: true,
    gradeLevel: { type: "G4" },
    section: { name: "A" },
    mosyDecisions: [],
    readingLevels: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  count.mockResolvedValue(0);
  learnerFindMany.mockResolvedValue([]);
  gradeFindFirst.mockResolvedValue(null);
  sectionFindFirst.mockResolvedValue(null);
  sectionFindMany.mockResolvedValue([]);
});

/** The `where` of the one learner.findMany that carries a `select` with `mosyDecisions` (the row list). */
function listWhere() {
  const call = learnerFindMany.mock.calls
    .map((c) => c[0] as { where: unknown; select: Record<string, unknown> })
    .find((a) => a.select && "mosyDecisions" in a.select);
  expect(call).toBeDefined();
  return call!.where;
}

describe("mosy export/page parity", () => {
  it("passes an identical list where for the same filters", async () => {
    await loadMosyPage({ ...base, page: 1 });
    const pageWhere = listWhere();
    learnerFindMany.mockClear();
    await loadMosyExport(base);
    const exportWhere = listWhere();
    expect(exportWhere).toEqual(pageWhere);
    // and it really carries the filters, so the equality is not vacuous
    expect(exportWhere).toMatchObject({
      schoolId: SCHOOL,
      deletedAt: null,
      archivedAt: null,
      gradeLevelId: "grade-4",
      sectionId: "section-a",
    });
    expect(JSON.stringify(exportWhere)).toContain("cruz");
    expect(JSON.stringify(exportWhere)).toContain("year-1");
  });

  it.each(["all", "not_updated", "for_decision", "moved_out", "stay"] as const)(
    "same where for status %s, with and without a tutor",
    async (status) => {
      for (const teacherId of ["tutor-1", null]) {
        learnerFindMany.mockClear();
        await loadMosyPage({ ...base, teacherId, status, page: 1 });
        const p = listWhere();
        learnerFindMany.mockClear();
        await loadMosyExport({ ...base, teacherId, status });
        expect(listWhere()).toEqual(p);
      }
    }
  );

  it("uses the same filtered where for the total count and the status-tab counts ignore filters", async () => {
    await loadMosyExport(base);
    const wheres = count.mock.calls.map((c) => JSON.stringify((c[0] as { where: unknown }).where));
    // 5 unfiltered status counts + 1 filtered total
    expect(wheres).toHaveLength(6);
    expect(wheres.filter((w) => w.includes("cruz"))).toHaveLength(1);
    expect(wheres.filter((w) => w.includes("grade-4"))).toHaveLength(1);
    for (const w of wheres) expect(w).toContain(SCHOOL);
  });

  it("export is not paginated and is capped at MOSY_EXPORT_MAX_ROWS", async () => {
    expect(MOSY_EXPORT_MAX_ROWS).toBe(5000);
    await loadMosyExport(base);
    const args = learnerFindMany.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.take).toBe(MOSY_EXPORT_MAX_ROWS);
    expect(args).not.toHaveProperty("skip");
    // the page, by contrast, paginates
    learnerFindMany.mockClear();
    await loadMosyPage({ ...base, page: 1 });
    const pageArgs = learnerFindMany.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((a) => "take" in a)!;
    expect(pageArgs).toHaveProperty("skip");
    expect(pageArgs.take).not.toBe(MOSY_EXPORT_MAX_ROWS);
  });

  it("marks truncated when more rows match than were returned", async () => {
    count.mockResolvedValue(6200);
    learnerFindMany.mockResolvedValue([learner(1), learner(2)]);
    const out = await loadMosyExport({ ...base, status: "all" });
    expect(out.rows).toHaveLength(2);
    expect(out.totalCount).toBe(6200);
    expect(out.truncated).toBe(true);
  });

  it("is not truncated when everything fits", async () => {
    count.mockResolvedValue(2);
    learnerFindMany.mockResolvedValue([learner(1), learner(2)]);
    const out = await loadMosyExport({ ...base, status: "all" });
    expect(out.truncated).toBe(false);
    expect(out.rows[0]!.listingName).toBe("Last1, First1");
  });

  it("pins the grade and section label lookups to the school", async () => {
    gradeFindFirst.mockResolvedValue({ type: "G4" });
    sectionFindFirst.mockResolvedValue({ name: "Sampaguita" });
    const out = await loadMosyExport(base);
    expect(gradeFindFirst.mock.calls[0]![0]).toMatchObject({ where: { id: "grade-4", schoolId: SCHOOL, deletedAt: null } });
    expect(sectionFindFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: "section-a", schoolId: SCHOOL, deletedAt: null },
    });
    expect(out.gradeLabel).toBe("Grade 4");
    expect(out.sectionLabel).toBe("Sampaguita");
  });

  it("no filters: no label lookups, null labels; section 'none' is labelled without a lookup", async () => {
    const out = await loadMosyExport({ ...base, grade: "all", section: "all" });
    expect(gradeFindFirst).not.toHaveBeenCalled();
    expect(sectionFindFirst).not.toHaveBeenCalled();
    expect(out.gradeLabel).toBeNull();
    expect(out.sectionLabel).toBeNull();
    const none = await loadMosyExport({ ...base, grade: "all", section: "none" });
    expect(sectionFindFirst).not.toHaveBeenCalled();
    expect(none.sectionLabel).toBe("No section");
  });

  it("stats come from the unfiltered status counts", async () => {
    count.mockImplementation(async ({ where }: { where: unknown }) => {
      const w = JSON.stringify(where);
      return w.includes("cruz") ? 1 : 10;
    });
    const out = await loadMosyExport(base);
    expect(out.stats.total).toBe(10);
    expect(out.totalCount).toBe(1);
  });
});
