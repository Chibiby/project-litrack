import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SummarySectionCard } from "@/components/summary/summary-section-card";
import { SummarySchoolSearch } from "@/components/summary/summary-school-search";
import type { SchoolPaging } from "@/components/summary/summary-school-paging";
import {
  pageSchoolSection,
  readSchoolQuery,
  readSchoolTableParams,
} from "@/lib/summary/shape/school-page";
import type { SummaryGroup, SummarySection } from "@/lib/summary/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const BASE = "/admin/monitoring/division-summary/learners";

function school(n: number): SummaryGroup {
  const name = `School ${String(n).padStart(2, "0")}`;
  const male = n;
  return {
    key: `school:${n}`,
    label: name,
    schoolId: `id-${n}`,
    base: 100,
    cells: {
      MALE: { count: male, base: 100, pct: male },
      FEMALE: { count: 100 - male, base: 100, pct: 100 - male },
    },
  };
}

function sectionOf(count: number): SummarySection {
  return {
    id: "gender",
    title: "Gender",
    kind: "single",
    byGrade: false,
    buckets: [
      { id: "MALE", label: "Male" },
      { id: "FEMALE", label: "Female" },
    ],
    baseLabel: "% of learners",
    table: { groups: Array.from({ length: count }, (_, i) => school(i + 1)) },
  };
}

const CODES = new Map(Array.from({ length: 30 }, (_, i) => [`id-${i + 1}`, `1300${String(i + 1).padStart(2, "0")}`]));

function pagingFor(section: SummarySection, flat: Record<string, string>): SchoolPaging {
  const params = readSchoolTableParams(flat, section.id);
  const query = readSchoolQuery(flat);
  return {
    basePath: BASE,
    searchParams: flat,
    query,
    params,
    page: pageSchoolSection(section, { query, params, schoolCodes: CODES }),
  };
}

function renderCard(flat: Record<string, string>, count = 30) {
  const section = sectionOf(count);
  return render(
    <SummarySectionCard section={section} level="school" paging={pagingFor(section, { level: "school", ...flat })} />
  );
}

function hrefOf(el: HTMLElement): URL {
  const href = el.closest("a")!.getAttribute("href")!;
  return new URL(href, "http://x");
}

describe("by-school summary table paging", () => {
  it("renders 25 of 30 schools and a pager", () => {
    renderCard({});
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(25);
    expect(rows[0]!.textContent).toContain("School 01");

    const nav = screen.getByRole("navigation", { name: "Gender pages" });
    expect(within(nav).getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByText("Showing 1–25 of 30 schools")).toBeTruthy();
    expect(within(nav).getByText("Previous").closest("a")).toBeNull();
  });

  it("shows the rest on page 2 and links Previous back to page 1 without the param", () => {
    renderCard({ "page.gender": "2" });
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(5);
    expect(screen.getByText("Showing 26–30 of 30 schools")).toBeTruthy();

    const nav = screen.getByRole("navigation", { name: "Gender pages" });
    const prev = hrefOf(within(nav).getByText("Previous"));
    expect(prev.searchParams.has("page.gender")).toBe(false);
    expect(prev.searchParams.get("level")).toBe("school");
    expect(prev.hash).toBe("");
    expect(within(nav).getByText("Next").closest("a")).toBeNull();
  });

  it("hides the pager when every school fits on one page", () => {
    renderCard({}, 12);
    expect(screen.queryByRole("navigation", { name: "Gender pages" })).toBeNull();
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(12);
  });

  it("points Next at the following page and keeps the other params", () => {
    renderCard({ q: "school", district: "Alabel 1" });
    const nav = screen.getByRole("navigation", { name: "Gender pages" });
    const next = hrefOf(within(nav).getByText("Next"));
    expect(next.searchParams.get("page.gender")).toBe("2");
    expect(next.searchParams.get("q")).toBe("school");
    expect(next.searchParams.get("district")).toBe("Alabel 1");
    expect(screen.getByText("Showing 1–25 of 30 matching schools")).toBeTruthy();
  });
});

describe("by-school summary table sorting", () => {
  it("marks the default name sort and links a first click on Total to descending", () => {
    renderCard({});
    const name = screen.getByRole("columnheader", { name: /School/ });
    expect(name.getAttribute("aria-sort")).toBe("ascending");

    const total = screen.getByRole("link", { name: /Sort by Total/ });
    const url = hrefOf(total);
    expect(url.searchParams.get("sort.gender")).toBe("total");
    expect(url.searchParams.get("dir.gender")).toBe("desc");
    expect(url.searchParams.has("page.gender")).toBe(false);
  });

  it("toggles the direction when the active column is clicked and drops the page", () => {
    renderCard({ "sort.gender": "MALE", "dir.gender": "desc", "page.gender": "2" });
    const header = screen.getByRole("columnheader", { name: /Male/ });
    expect(header.getAttribute("aria-sort")).toBe("descending");

    const url = hrefOf(screen.getByRole("link", { name: /Sort by Male/ }));
    expect(url.searchParams.get("sort.gender")).toBe("MALE");
    expect(url.searchParams.get("dir.gender")).toBe("asc");
    expect(url.searchParams.has("page.gender")).toBe(false);
  });

  it("sorts the rows by the chosen column", () => {
    renderCard({ "sort.gender": "MALE", "dir.gender": "desc" });
    const first = screen.getAllByRole("row")[1]!;
    expect(first.textContent).toContain("School 30");
  });

  it("uses the name column default direction on a first click when another column is active", () => {
    renderCard({ "sort.gender": "MALE" });
    const url = hrefOf(screen.getByRole("link", { name: /Sort by School/ }));
    expect(url.searchParams.get("sort.gender")).toBe("name");
    expect(url.searchParams.get("dir.gender")).toBe("asc");
  });

  it("has no sort links on a table that is not paged", () => {
    render(<SummarySectionCard section={sectionOf(3)} level="school" />);
    expect(screen.queryByRole("link", { name: /Sort by/ })).toBeNull();
  });
});

describe("by-school summary search", () => {
  it("filters a table by school name or school ID", () => {
    renderCard({ q: "School 07" });
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);

    cleanup();
    renderCard({ q: "130012" });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("School 12");
  });

  it("names the search and offers to clear it when nothing matches", () => {
    renderCard({ q: "zzz", "page.gender": "2", district: "Alabel 1" });
    expect(screen.getByText("No schools match your search")).toBeTruthy();
    expect(screen.getByText(/“zzz”/)).toBeTruthy();

    const url = hrefOf(screen.getByRole("link", { name: "Clear search" }));
    expect(url.searchParams.has("q")).toBe(false);
    expect(url.searchParams.has("page.gender")).toBe(false);
    expect(url.searchParams.get("district")).toBe("Alabel 1");
  });

  it("submits the text as q and sends every table back to page 1", () => {
    render(
      <SummarySchoolSearch
        basePath={BASE}
        searchParams={{ level: "school", "page.gender": "3", "sort.gender": "total" }}
        query=""
      />
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Search schools" }), {
      target: { value: "  Alabel " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0]![0] as string, "http://x");
    expect(url.searchParams.get("q")).toBe("Alabel");
    expect(url.searchParams.has("page.gender")).toBe(false);
    expect(url.searchParams.get("sort.gender")).toBe("total");
    expect(url.searchParams.get("level")).toBe("school");
  });

  it("shows a clear control when q is set and removes q on click", () => {
    render(<SummarySchoolSearch basePath={BASE} searchParams={{ level: "school", q: "glan" }} query="glan" />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("glan");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    const url = new URL(push.mock.calls[0]![0] as string, "http://x");
    expect(url.searchParams.has("q")).toBe(false);
    expect(url.searchParams.get("level")).toBe("school");
  });

  it("has no clear control when there is no search", () => {
    render(<SummarySchoolSearch basePath={BASE} searchParams={{ level: "school" }} query="" />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });
});
