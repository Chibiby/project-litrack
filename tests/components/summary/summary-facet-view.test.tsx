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

const defaultLoad = async (_scope: unknown, _params: unknown): Promise<unknown> => ({
  level: "school",
  subtitle: "Figures",
  schoolCount: 1,
  computedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
  notes: [],
  gaps: [],
  sections: [],
  lists: [],
  params: { level: "school" },
});
// Outside a React request `cache()` does not dedupe, so the early start in
// SummaryFacetView and the Suspense child each call this; tests set one
// implementation for every call instead of a single-use one.
const load = vi.fn(defaultLoad);

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
  load.mockImplementation(defaultLoad);
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

    expect(load).toHaveBeenCalled();
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

describe("SummaryFacetView — by-district results are paged with grade rows kept under their district", () => {
  const COUNT = 12;
  const names = Array.from({ length: COUNT }, (_, i) => `District ${String(i + 1).padStart(2, "0")}`);

  function districtResult() {
    const row = (name: string, i: number, gradeType: string | null) => ({
      key: gradeType ? `district:${name}|${gradeType}` : `district:${name}`,
      label: name,
      district: name,
      gradeType,
      gradeLabel: gradeType ?? "All grades",
      base: (i + 1) * 10,
      cells: {
        MALE: { count: i + 1, base: (i + 1) * 10, pct: 10 },
        FEMALE: { count: i + 1, base: (i + 1) * 10, pct: 10 },
      },
    });
    return {
      facetId: "learners",
      level: "district",
      subtitle: "Figures",
      schoolCount: 30,
      computedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      notes: [],
      gaps: [],
      lists: [],
      params: { level: "district" },
      sections: [
        {
          id: "gender",
          title: "Gender",
          kind: "single",
          byGrade: true,
          buckets: [
            { id: "MALE", label: "Male" },
            { id: "FEMALE", label: "Female" },
          ],
          baseLabel: "% of learners",
          table: {
            groups: names.flatMap((n, i) => [row(n, i, "G1"), row(n, i, "G2"), row(n, i, null)]),
          },
        },
      ],
    };
  }

  async function renderDistricts(searchParams: Record<string, string>) {
    load.mockImplementation(async () => districtResult() as never);
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: { level: "district", ...searchParams },
      basePath: "/admin/summary",
      userId: "admin-1",
    });
    const results = findElementNamed(jsx, "SummaryFacetResults");
    expect(results).not.toBeNull();
    return { jsx, ...render(await runAsync(results!)) };
  }

  const rowKeys = (container: HTMLElement) =>
    [...container.querySelectorAll("tr[data-group-key]")].map((r) => r.getAttribute("data-group-key"));

  it("renders 5 districts with their grade rows and a pager", async () => {
    const { container } = await renderDistricts({});
    const keys = rowKeys(container);
    expect(keys).toHaveLength(15);
    expect(keys.slice(0, 3)).toEqual([
      "district:District 01",
      "district:District 01|G1",
      "district:District 01|G2",
    ]);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(screen.getByText("Showing 1–5 of 12 districts")).toBeTruthy();
  });

  it("renders the 2 remaining districts on page 3", async () => {
    const { container } = await renderDistricts({ "page.gender": "3" });
    expect(rowKeys(container)).toHaveLength(6);
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
  });

  it("pager and sort links use the same param scheme as schools", async () => {
    await renderDistricts({ q: "district" });
    const next = screen.getByRole("link", { name: /Next/ });
    const nextUrl = new URL(next.getAttribute("href")!, "http://x");
    expect(nextUrl.searchParams.get("page.gender")).toBe("2");
    expect(nextUrl.searchParams.get("q")).toBe("district");
    const sort = screen.getByRole("link", { name: /Sort by.*Total/ });
    const sortUrl = new URL(sort.getAttribute("href")!, "http://x");
    expect(sortUrl.searchParams.get("sort.gender")).toBe("total");
    expect(sortUrl.searchParams.get("dir.gender")).toBe("desc");
  });

  it("narrows by district name", async () => {
    const { container } = await renderDistricts({ q: "district 07" });
    expect(rowKeys(container)).toEqual([
      "district:District 07",
      "district:District 07|G1",
      "district:District 07|G2",
    ]);
    expect(screen.queryByRole("navigation", { name: "Gender pages" })).toBeNull();
  });

  it("says so, with a way out, when no district matches", async () => {
    await renderDistricts({ q: "zzz" });
    expect(screen.getByText("No districts match your search")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clear search" })).toBeTruthy();
  });

  it("offers a district search box", async () => {
    const { jsx } = await renderDistricts({});
    const search = findElementNamed(jsx, "SummarySchoolSearch");
    expect(search).not.toBeNull();
    expect(search!.props).toMatchObject({ unit: "districts" });
  });
});

describe("SummaryFacetView — footer refresh cadence follows the cache rule", () => {
  afterEach(() => vi.useRealTimers());

  async function footer(params: Record<string, string>) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T04:00:00.000Z"));
    load.mockImplementation(async () => ({ ...(await defaultLoad(null, null)) as object, params }) as never);
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: {},
      basePath: "/admin/summary",
      userId: "admin-1",
    });
    const bar = findElementNamed(jsx, "SummaryPeriodBar");
    expect(bar).not.toBeNull();
    return render(await runAsync(bar!)).container.textContent ?? "";
  }

  it("says every hour for a month before the current one", async () => {
    const text = await footer({ level: "overall", month: "2026-09" });
    expect(text).toContain("refreshed every hour");
    expect(text).not.toContain("every 5 minutes");
  });

  it("says every hour for a range that ends before the current month", async () => {
    expect(await footer({ level: "overall", from: "2026-07", to: "2026-09" })).toContain("every hour");
  });

  it("says every 5 minutes for the current month or a period-less facet", async () => {
    expect(await footer({ level: "overall", month: "2026-10" })).toContain("refreshed every 5 minutes");
    expect(await footer({ level: "overall" })).toContain("refreshed every 5 minutes");
  });
});

describe("SummaryFacetView — figures start loading before the school list resolves", () => {
  it("calls the facet load while resolveScopeSchools is still pending", async () => {
    const scopeSchools = await import("@/lib/summary/scope-schools");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(scopeSchools, "resolveScopeSchools")
      .mockImplementationOnce(async () => {
        await gate;
        return SCHOOLS as never;
      });

    const pending = SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: {},
      basePath: "/admin/summary",
      userId: "admin-1",
    });
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(load).toHaveBeenCalledTimes(1);
    release();
    await pending;
    spy.mockRestore();
  });

  it("does not load figures when the district admin has no districts", async () => {
    await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "districts", districts: [] },
      searchParams: {},
      basePath: "/district/summary",
      userId: "district-1",
    });
    expect(load).not.toHaveBeenCalled();
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
    load.mockImplementation(async () => bigResult() as never);
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
