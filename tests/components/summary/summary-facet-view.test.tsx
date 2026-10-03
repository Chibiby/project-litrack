import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { SummaryFacetView } from "@/components/summary/summary-facet-view";

/**
 * `/admin/summary/<facet>?level=school` at division scope with no district
 * chosen used to be gated behind a district prompt because every school's rows
 * made a multi-MB page. Each table now renders one page of schools, so the
 * facet loads for the whole division and the gate is gone.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

const load = vi.fn(async (_scope: unknown, _params: unknown) => ({
  level: "school",
  subtitle: "Figures",
  schoolCount: 1,
  computedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
  notes: [],
  gaps: [],
  sections: [],
  lists: [],
  params: { level: "school" },
}));

vi.mock("@/lib/summary/facets", () => ({
  getSummaryFacet: () => ({ load }),
  facetParamsFromSearch: () => ({}),
}));

vi.mock("@/lib/demo/session", () => ({ isDemoVisible: async () => false }));

const SCHOOLS = [
  {
    id: "s1",
    name: "Alabel Central ES",
    schoolIdCode: "130001",
    district: "Alabel 1",
    division: "Sarangani",
    region: "XII",
    isActive: true,
  },
];

vi.mock("@/lib/summary/scope-schools", () => ({
  resolveScopeSchools: async () => SCHOOLS,
}));

vi.mock("@/components/summary/resolve-page-scope", () => ({
  resolvePageSummaryScope: async (
    _adminScope: unknown,
    requested: { district?: string; schoolId?: string }
  ) => ({
    scope: requested.schoolId
      ? { kind: "school", schoolId: requested.schoolId }
      : requested.district
        ? { kind: "districts", districts: [requested.district] }
        : { kind: "all" },
    district: requested.district ?? null,
    school: null,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

/**
 * `SummaryPeriodBar` and `SummaryFacetResults` are async server components,
 * which only render correctly through Next's RSC pipeline. The tests walk the
 * un-rendered element graph to find one by its function name and, where they
 * need its output, await it themselves.
 */
function findElementNamed(node: ReactNode, name: string): ReactElement | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findElementNamed(n, name);
      if (found) return found;
    }
    return null;
  }
  const el = node as ReactElement;
  if (!("type" in el)) return null;
  if (typeof el.type === "function" && el.type.name === name) return el;
  const children = (el.props as { children?: ReactNode } | undefined)?.children;
  return findElementNamed(children, name);
}

async function runAsync(el: ReactElement): Promise<ReactNode> {
  const fn = el.type as (props: unknown) => Promise<ReactNode>;
  return fn(el.props);
}

describe("SummaryFacetView — division scope, By school, no district picked", () => {
  it("loads the facet for every school instead of asking for a district", async () => {
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: { level: "school" },
      basePath: "/admin/summary",
      userId: "admin-1",
    });

    const results = findElementNamed(jsx, "SummaryFacetResults");
    expect(results).not.toBeNull();
    render(await runAsync(results!));

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toEqual({ kind: "all" });
    expect(screen.queryByText("Pick a district to see its schools")).toBeNull();
  });

  it("does not gate a district admin's own (small) scope", async () => {
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "districts", districts: ["Alabel 1"] },
      searchParams: { level: "school" },
      basePath: "/district/summary",
      userId: "district-1",
    });

    expect(findElementNamed(jsx, "SummaryFacetResults")).not.toBeNull();
  });

  it("does not gate division scope once a district is chosen", async () => {
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: { level: "school", district: "Alabel 1" },
      basePath: "/admin/summary",
      userId: "admin-1",
    });

    expect(findElementNamed(jsx, "SummaryFacetResults")).not.toBeNull();
  });

  it("offers the shared school search above the by-school results", async () => {
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: { level: "school", q: "alabel" },
      basePath: "/admin/summary",
      userId: "admin-1",
    });

    const search = findElementNamed(jsx, "SummarySchoolSearch");
    expect(search).not.toBeNull();
    expect(search!.props).toMatchObject({
      basePath: "/admin/summary/learners",
      query: "alabel",
    });
  });

  it("does not offer the school search at the overall level", async () => {
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: {},
      basePath: "/admin/summary",
      userId: "admin-1",
    });

    expect(findElementNamed(jsx, "SummarySchoolSearch")).toBeNull();
  });
});

describe("SummaryFacetView — by-school results are paged before they reach the table", () => {
  const COUNT = 60;
  const sixty = Array.from({ length: COUNT }, (_, i) => {
    const n = i + 1;
    return {
      id: `id-${n}`,
      name: `School ${String(n).padStart(2, "0")}`,
      schoolIdCode: `1300${String(n).padStart(2, "0")}`,
      district: "Alabel 1",
      division: "Sarangani",
      region: "XII",
      isActive: true,
    };
  });

  function bigResult() {
    return {
      facetId: "learners",
      level: "school",
      subtitle: "Figures",
      schoolCount: COUNT,
      computedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      notes: [],
      gaps: [],
      lists: [],
      params: { level: "school" },
      sections: [
        {
          id: "gender",
          title: "Gender",
          kind: "single",
          byGrade: false,
          buckets: [
            { id: "MALE", label: "Male" },
            { id: "FEMALE", label: "Female" },
          ],
          baseLabel: "% of learners",
          table: {
            groups: sixty.map((s, i) => ({
              key: `school:${s.id}`,
              label: s.name,
              schoolId: s.id,
              base: (i + 1) * 10,
              cells: {
                MALE: { count: i + 1, base: (i + 1) * 10, pct: 10 },
                FEMALE: { count: i + 1, base: (i + 1) * 10, pct: 10 },
              },
            })),
          },
        },
      ],
    };
  }

  async function renderResults(searchParams: Record<string, string>) {
    SCHOOLS.splice(0, SCHOOLS.length, ...sixty);
    load.mockImplementationOnce(async () => bigResult() as never);
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: { level: "school", ...searchParams },
      basePath: "/admin/summary",
      userId: "admin-1",
    });
    const results = findElementNamed(jsx, "SummaryFacetResults");
    expect(results).not.toBeNull();
    return render(await runAsync(results!));
  }

  const rowKeys = (container: HTMLElement) =>
    [...container.querySelectorAll("tr[data-group-key]")].map((r) => r.getAttribute("data-group-key"));

  afterEach(() => {
    SCHOOLS.splice(0, SCHOOLS.length, {
      id: "s1",
      name: "Alabel Central ES",
      schoolIdCode: "130001",
      district: "Alabel 1",
      division: "Sarangani",
      region: "XII",
      isActive: true,
    });
  });

  it("renders exactly 25 school rows and a pager for 60 schools", async () => {
    const { container } = await renderResults({});
    expect(rowKeys(container)).toHaveLength(25);
    expect(screen.getByRole("navigation", { name: "Gender pages" })).toBeTruthy();
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(screen.getByText("Showing 1–25 of 60 schools")).toBeTruthy();
  });

  it("sorts the whole list before slicing", async () => {
    const { container } = await renderResults({ "sort.gender": "total", "dir.gender": "desc" });
    const keys = rowKeys(container);
    expect(keys).toHaveLength(25);
    expect(keys[0]).toBe("school:id-60");
    expect(keys[24]).toBe("school:id-36");
  });

  it("renders the 10 remaining schools on page 3", async () => {
    const { container } = await renderResults({ "page.gender": "3" });
    expect(rowKeys(container)).toHaveLength(10);
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
  });

  it("finds one school by its school ID", async () => {
    const { container } = await renderResults({ q: "130037" });
    expect(rowKeys(container)).toEqual(["school:id-37"]);
    expect(screen.queryByRole("navigation", { name: "Gender pages" })).toBeNull();
  });
});
