import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { SummaryFacetView } from "@/components/summary/summary-facet-view";
import { SummaryDistrictPickPrompt } from "@/components/summary/summary-district-pick-prompt";

/**
 * `/admin/summary/<facet>?level=school` at division scope with no district
 * chosen used to call `facet.load` over every school in the division (300+
 * schools, up to ~2 MB for the learners facet) and never finish. The fix is
 * to never call `facet.load` for that scope — this test fails if that call
 * comes back.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

const load = vi.fn(async () => ({
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
 * Walks the plain React element tree WITHOUT rendering it: `SummaryPeriodBar`
 * and `SummaryFacetResults` are async server components, which only render
 * correctly through Next's RSC pipeline — inspecting the un-rendered element
 * graph lets these two tests assert the district-pick prompt is absent from
 * the normal (unaffected) scopes without invoking those async children.
 */
function containsType(node: ReactNode, type: unknown): boolean {
  if (node == null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => containsType(n, type));
  const el = node as ReactElement;
  if (!("type" in el)) return false;
  if (el.type === type) return true;
  const children = (el.props as { children?: ReactNode } | undefined)?.children;
  return containsType(children, type);
}

describe("SummaryFacetView — division scope, By school, no district picked", () => {
  it("never calls facet.load and renders the district-pick prompt instead", async () => {
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: { level: "school" },
      basePath: "/admin/summary",
      userId: "admin-1",
    });

    render(jsx);

    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText("Pick a district to see its schools")).not.toBeNull();
  });

  it("does not gate a district admin's own (small) scope the same way", async () => {
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "districts", districts: ["Alabel 1"] },
      searchParams: { level: "school" },
      basePath: "/district/summary",
      userId: "district-1",
    });

    expect(containsType(jsx, SummaryDistrictPickPrompt)).toBe(false);
  });

  it("does not gate division scope once a district is chosen", async () => {
    const jsx = await SummaryFacetView({
      facetId: "learners",
      adminScope: { kind: "division" },
      searchParams: { level: "school", district: "Alabel 1" },
      basePath: "/admin/summary",
      userId: "admin-1",
    });

    expect(containsType(jsx, SummaryDistrictPickPrompt)).toBe(false);
  });
});
