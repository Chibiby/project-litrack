import { describe, expect, it } from "vitest";
import { DISTRICT_PAGE_SIZE, pageDistrictSection } from "@/lib/summary/shape/district-page";
import type { SchoolTableParams } from "@/lib/summary/shape/school-page";
import type { SummaryCell, SummaryGroup, SummarySection } from "@/lib/summary/types";

const NAME: SchoolTableParams = { sort: "name", dir: "asc", page: 1 };

function cell(count: number, base: number): SummaryCell {
  return { count, base, pct: base === 0 ? null : Math.round((count / base) * 1000) / 10 };
}

/** Rollup order: grade rows first, the "All grades" total last. */
function districtRows(name: string, base: number): SummaryGroup[] {
  const mk = (gradeType: string | null, n: number): SummaryGroup => ({
    key: gradeType ? `district:${name}|${gradeType}` : `district:${name}`,
    label: name,
    district: name,
    gradeType,
    gradeLabel: gradeType ?? "All grades",
    base: n,
    cells: { a: cell(n, n + 1) },
  });
  return [mk("G1", base), mk("G2", base), mk(null, base * 2)];
}

function section(names: { name: string; base: number }[]): SummarySection {
  return {
    id: "sec",
    title: "Sec",
    kind: "single",
    byGrade: true,
    buckets: [{ id: "a", label: "A" }],
    baseLabel: "learners",
    table: { groups: names.flatMap((n) => districtRows(n.name, n.base)) },
  };
}

function twelve(): SummarySection {
  return section(
    Array.from({ length: 12 }, (_, i) => ({ name: `D${String(i).padStart(2, "0")}`, base: i + 1 })),
  );
}

const keysOf = (s: SummarySection) => s.table.groups.map((g) => g.key);

describe("pageDistrictSection", () => {
  it("shows at most 5 districts per page and never splits a district", () => {
    expect(DISTRICT_PAGE_SIZE).toBe(5);
    const sizes = [1, 2, 3].map((page) => {
      const r = pageDistrictSection(twelve(), { query: "", params: { ...NAME, page } });
      const districts = new Set(r.section.table.groups.map((g) => g.district));
      expect(r.section.table.groups).toHaveLength(districts.size * 3);
      return districts.size;
    });
    expect(sizes).toEqual([5, 5, 2]);
  });

  it("keeps each district's grade rows attached in their original order", () => {
    const r = pageDistrictSection(twelve(), { query: "", params: NAME });
    expect(keysOf(r.section).slice(0, 3)).toEqual([
      "district:D00|G1",
      "district:D00|G2",
      "district:D00",
    ]);
    expect(r.totalDistricts).toBe(12);
    expect(r.pageCount).toBe(3);
  });

  it("narrows by district name, case-insensitively", () => {
    const r = pageDistrictSection(twelve(), { query: "d1", params: NAME });
    expect(r.matchedDistricts).toBe(2);
    expect(new Set(r.section.table.groups.map((g) => g.district))).toEqual(new Set(["D10", "D11"]));
    expect(r.totalDistricts).toBe(12);
  });

  it("returns nothing for a search with no match", () => {
    const r = pageDistrictSection(twelve(), { query: "zzz", params: NAME });
    expect(r.matchedDistricts).toBe(0);
    expect(r.section.table.groups).toEqual([]);
    expect(r.pageCount).toBe(1);
  });

  it("sorts districts by the total row's value, whole list before slicing", () => {
    const r = pageDistrictSection(twelve(), {
      query: "",
      params: { sort: "total", dir: "desc", page: 1 },
    });
    const first = r.section.table.groups.filter((g) => !g.gradeType).map((g) => g.district);
    expect(first).toEqual(["D11", "D10", "D09", "D08", "D07"]);
  });

  it("sorts by name descending", () => {
    const r = pageDistrictSection(twelve(), {
      query: "",
      params: { sort: "name", dir: "desc", page: 1 },
    });
    expect(r.section.table.groups[2]!.district).toBe("D11");
  });

  it("sorts by a bucket's pct", () => {
    const r = pageDistrictSection(twelve(), {
      query: "",
      params: { sort: "a", dir: "asc", page: 1 },
    });
    expect(r.section.table.groups[2]!.district).toBe("D00");
  });

  it("keeps districts whose name contains '|' as separate whole blocks", () => {
    const sec = section([
      { name: "North|East", base: 1 },
      { name: "North", base: 2 },
    ]);
    const r = pageDistrictSection(sec, { query: "", params: NAME });
    expect(r.totalDistricts).toBe(2);
    expect(r.section.table.groups).toHaveLength(6);
    const q = pageDistrictSection(sec, { query: "north|east", params: NAME });
    expect(q.matchedDistricts).toBe(1);
    expect(keysOf(q.section)).toEqual([
      "district:North|East|G1",
      "district:North|East|G2",
      "district:North|East",
    ]);
  });

  it("clamps an out-of-range page and does not mutate the input", () => {
    const sec = twelve();
    const before = sec.table.groups.length;
    const r = pageDistrictSection(sec, { query: "", params: { ...NAME, page: 99 } });
    expect(r.page).toBe(3);
    expect(sec.table.groups).toHaveLength(before);
  });
});
