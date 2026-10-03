import { describe, expect, it } from "vitest";
import {
  SCHOOL_PAGE_SIZE,
  pageSchoolSection,
  readSchoolQuery,
  readSchoolTableParams,
  tableParamKey,
  tableParamNames,
  type SchoolTableParams,
} from "@/lib/summary/shape/school-page";
import type { SummaryCell, SummaryGroup, SummarySection } from "@/lib/summary/types";

function cell(count: number, base: number, mean?: number | null): SummaryCell {
  const c: SummaryCell = { count, base, pct: base === 0 ? null : Math.round((count / base) * 1000) / 10 };
  if (mean !== undefined) c.mean = mean;
  return c;
}

function schoolRow(
  id: string,
  name: string,
  base: number,
  cells: Record<string, SummaryCell>,
  extra: Partial<SummaryGroup> = {},
): SummaryGroup {
  return { key: `school:${id}`, label: name, schoolId: id, base, cells, ...extra };
}

function section(groups: SummaryGroup[], over: Partial<SummarySection> = {}): SummarySection {
  return {
    id: "sec",
    title: "Sec",
    kind: "single",
    byGrade: false,
    buckets: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    baseLabel: "learners",
    table: { groups },
    ...over,
  };
}

const NAME: SchoolTableParams = { sort: "name", dir: "asc", page: 1 };

function many(n: number): SummarySection {
  const groups: SummaryGroup[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = `s${String(i).padStart(2, "0")}`;
    groups.push(schoolRow(id, `School ${id}`, i, { a: cell(i, i + 1), b: cell(0, i + 1) }));
  }
  return section(groups);
}

const noCodes = new Map<string, string>();

function labels(s: SummarySection): string[] {
  return s.table.groups.map((g) => g.label);
}

describe("pageSchoolSection paging", () => {
  it("splits 60 schools into 25/25/10", () => {
    const sec = many(60);
    const sizes = [1, 2, 3].map((page) => {
      const r = pageSchoolSection(sec, {
        query: "",
        params: { ...NAME, page },
        schoolCodes: noCodes,
      });
      expect(r.pageCount).toBe(3);
      expect(r.totalSchools).toBe(60);
      expect(r.matchedSchools).toBe(60);
      expect(r.pageSize).toBe(SCHOOL_PAGE_SIZE);
      return r.section.table.groups.length;
    });
    expect(sizes).toEqual([25, 25, 10]);
  });

  it("clamps the page into range", () => {
    const sec = many(60);
    const hi = pageSchoolSection(sec, { query: "", params: { ...NAME, page: 99 }, schoolCodes: noCodes });
    expect(hi.page).toBe(3);
    expect(hi.section.table.groups).toHaveLength(10);
    const lo = pageSchoolSection(sec, { query: "", params: { ...NAME, page: 0 }, schoolCodes: noCodes });
    expect(lo.page).toBe(1);
  });

  it("returns pageCount 1 and no groups when nothing matches", () => {
    const r = pageSchoolSection(many(5), { query: "zzz", params: NAME, schoolCodes: noCodes });
    expect(r.pageCount).toBe(1);
    expect(r.page).toBe(1);
    expect(r.matchedSchools).toBe(0);
    expect(r.totalSchools).toBe(5);
    expect(r.section.table.groups).toEqual([]);
  });

  it("honours a custom page size", () => {
    const r = pageSchoolSection(many(7), { query: "", params: NAME, schoolCodes: noCodes, pageSize: 3 });
    expect(r.pageCount).toBe(3);
    expect(r.section.table.groups).toHaveLength(3);
  });
});

describe("pageSchoolSection search", () => {
  const sec = section([
    schoolRow("s1", "Alabel CES", 1, {}),
    schoolRow("s2", "Bagacay ES", 1, {}),
    schoolRow("s3", "Glan CES", 1, {}),
  ]);
  const codes = new Map([
    ["s1", "130001"],
    ["s2", "130002"],
    ["s3", "999777"],
  ]);

  it("matches the school name case-insensitively", () => {
    const r = pageSchoolSection(sec, { query: "ces", params: NAME, schoolCodes: codes });
    expect(labels(r.section)).toEqual(["Alabel CES", "Glan CES"]);
    expect(r.matchedSchools).toBe(2);
  });

  it("matches the school ID code", () => {
    const r = pageSchoolSection(sec, { query: "9997", params: NAME, schoolCodes: codes });
    expect(labels(r.section)).toEqual(["Glan CES"]);
  });

  it("matches everything for an empty query", () => {
    const r = pageSchoolSection(sec, { query: "", params: NAME, schoolCodes: codes });
    expect(r.matchedSchools).toBe(3);
  });
});

describe("pageSchoolSection sort", () => {
  it("sorts by total desc", () => {
    const sec = section([
      schoolRow("s1", "A", 5, {}),
      schoolRow("s2", "B", 50, {}),
      schoolRow("s3", "C", 20, {}),
    ]);
    const r = pageSchoolSection(sec, {
      query: "",
      params: { sort: "total", dir: "desc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(labels(r.section)).toEqual(["B", "C", "A"]);
  });

  it("sorts by bucket pct with a null pct last in both directions", () => {
    const sec = section([
      schoolRow("s1", "A", 10, { a: cell(2, 10) }),
      schoolRow("s2", "B", 0, { a: cell(0, 0) }),
      schoolRow("s3", "C", 10, { a: cell(8, 10) }),
    ]);
    const asc = pageSchoolSection(sec, {
      query: "",
      params: { sort: "a", dir: "asc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(labels(asc.section)).toEqual(["A", "C", "B"]);
    const desc = pageSchoolSection(sec, {
      query: "",
      params: { sort: "a", dir: "desc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(labels(desc.section)).toEqual(["C", "A", "B"]);
  });

  it("breaks ties by school name ascending", () => {
    const sec = section([
      schoolRow("s1", "Zeta", 10, { a: cell(5, 10) }),
      schoolRow("s2", "Alpha", 10, { a: cell(5, 10) }),
    ]);
    const r = pageSchoolSection(sec, {
      query: "",
      params: { sort: "a", dir: "desc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(labels(r.section)).toEqual(["Alpha", "Zeta"]);
  });

  it("sorts an average section by mean, null last", () => {
    const sec = section(
      [
        schoolRow("s1", "A", 4, { a: cell(0, 4, 71.5) }),
        schoolRow("s2", "B", 4, { a: cell(0, 4, null) }),
        schoolRow("s3", "C", 4, { a: cell(0, 4, 88) }),
      ],
      { kind: "average" },
    );
    const desc = pageSchoolSection(sec, {
      query: "",
      params: { sort: "a", dir: "desc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(labels(desc.section)).toEqual(["C", "A", "B"]);
    const asc = pageSchoolSection(sec, {
      query: "",
      params: { sort: "a", dir: "asc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(labels(asc.section)).toEqual(["A", "C", "B"]);
  });

  it("treats an unknown sort id as name", () => {
    const sec = section([schoolRow("s1", "Beta", 1, {}), schoolRow("s2", "Alpha", 9, {})]);
    const r = pageSchoolSection(sec, {
      query: "",
      params: { sort: "nope", dir: "asc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(labels(r.section)).toEqual(["Alpha", "Beta"]);
  });

  it("sorts by name descending", () => {
    const sec = section([schoolRow("s1", "Alpha", 1, {}), schoolRow("s2", "Beta", 1, {})]);
    const r = pageSchoolSection(sec, {
      query: "",
      params: { sort: "name", dir: "desc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(labels(r.section)).toEqual(["Beta", "Alpha"]);
  });
});

describe("pageSchoolSection blocks", () => {
  it("keeps a school's grade rows before its total row, and uses the total to sort", () => {
    const block = (id: string, name: string, total: number): SummaryGroup[] => [
      schoolRow(id, name, 1, {}, { key: `school:${id}|G1`, gradeType: "G1", gradeLabel: "Grade 1" }),
      schoolRow(id, name, 2, {}, { key: `school:${id}|G2`, gradeType: "G2", gradeLabel: "Grade 2" }),
      schoolRow(id, name, total, {}, { key: `school:${id}`, gradeType: null, gradeLabel: "All grades" }),
    ];
    const sec = section([...block("s1", "A", 10), ...block("s2", "B", 99)], { byGrade: true });
    const r = pageSchoolSection(sec, {
      query: "",
      params: { sort: "total", dir: "desc", page: 1 },
      schoolCodes: noCodes,
    });
    expect(r.totalSchools).toBe(2);
    expect(r.section.table.groups.map((g) => g.key)).toEqual([
      "school:s2|G1",
      "school:s2|G2",
      "school:s2",
      "school:s1|G1",
      "school:s1|G2",
      "school:s1",
    ]);
  });

  it("never filters out groups without a schoolId", () => {
    const orphan: SummaryGroup = { key: "overall", label: "All schools", base: 1, cells: {} };
    const sec = section([schoolRow("s1", "Alpha", 1, {}), orphan]);
    const r = pageSchoolSection(sec, { query: "zzz", params: NAME, schoolCodes: noCodes });
    expect(r.section.table.groups).toEqual([orphan]);
  });

  it("does not mutate its input", () => {
    const sec = many(30);
    const before = JSON.stringify(sec);
    const firstGroups = sec.table.groups;
    const r = pageSchoolSection(sec, {
      query: "school",
      params: { sort: "total", dir: "desc", page: 2 },
      schoolCodes: noCodes,
    });
    expect(JSON.stringify(sec)).toBe(before);
    expect(sec.table.groups).toBe(firstGroups);
    expect(r.section).not.toBe(sec);
    expect(r.section.table).not.toBe(sec.table);
  });
});

describe("param helpers", () => {
  it("tableParamKey replaces unsafe characters", () => {
    expect(tableParamKey("reading:levels.g3")).toBe("reading-levels-g3");
    expect(tableParamKey("ok_id-1")).toBe("ok_id-1");
  });

  it("tableParamNames builds the three names", () => {
    expect(tableParamNames("a:b")).toEqual({ sort: "sort.a-b", dir: "dir.a-b", page: "page.a-b" });
  });

  it("readSchoolTableParams applies defaults", () => {
    expect(readSchoolTableParams({}, "s")).toEqual({ sort: "name", dir: "asc", page: 1 });
    expect(readSchoolTableParams({ "sort.s": "total" }, "s")).toEqual({
      sort: "total",
      dir: "desc",
      page: 1,
    });
    expect(
      readSchoolTableParams({ "sort.s": "a", "dir.s": "asc", "page.s": "4" }, "s"),
    ).toEqual({ sort: "a", dir: "asc", page: 4 });
    expect(readSchoolTableParams({ "dir.s": "desc" }, "s").dir).toBe("desc");
  });

  it("readSchoolTableParams survives garbage", () => {
    const p = readSchoolTableParams(
      { "sort.s": "   ", "dir.s": "sideways", "page.s": "abc" },
      "s",
    );
    expect(p).toEqual({ sort: "name", dir: "asc", page: 1 });
    expect(readSchoolTableParams({ "page.s": "-3" }, "s").page).toBe(1);
    expect(readSchoolTableParams({ "page.s": "2.5" }, "s").page).toBe(1);
    expect(readSchoolTableParams({ "page.s": "0" }, "s").page).toBe(1);
  });

  it("readSchoolQuery trims and caps", () => {
    expect(readSchoolQuery({})).toBe("");
    expect(readSchoolQuery({ q: "  glan  " })).toBe("glan");
    expect(readSchoolQuery({ q: "x".repeat(300) })).toHaveLength(100);
  });
});
