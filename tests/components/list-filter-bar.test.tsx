import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { ListFilterBar } from "@/components/admin/management/list-filter-bar";
import {
  districtField,
  schoolField,
  sectionField,
} from "@/components/admin/management/filter-fields";

/**
 * The Management filter bar. Every value lives in the URL, so the behaviours
 * that matter are the hrefs it navigates to: any change drops `page`, a parent
 * filter (district, school) clears the children that could now point outside it,
 * "Clear filters" keeps only the sort, and the section picker stays disabled
 * until a school is chosen.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const push = vi.fn();
let currentQuery = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/management/teachers",
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const BASE = "/admin/management/teachers";
const DISTRICTS = [
  { district: "Alamada", schools: 4 },
  { district: "Banga", schools: 2 },
];
const SCHOOLS = [
  { id: "s1", name: "Naidas T. Opong ES", schoolIdCode: "130554", district: "Alamada" },
  { id: "s2", name: "Rizal CES", schoolIdCode: "130555", district: "Alamada" },
];
const SECTIONS = [{ id: "sec1", name: "Rizal", grade: "G3" as const, gradeLabel: "Grade 3" }];
const SORTS = [
  { value: "alphabetical", label: "Alphabetical" },
  { value: "school", label: "School" },
] as const;

type Scope = { district?: string; schoolId?: string; section?: string };

/** The same cascade the Teachers page builds. */
function teacherFields({ district, schoolId, section }: Scope = {}) {
  return [
    districtField(DISTRICTS, district, ["schoolId", "section"]),
    schoolField(SCHOOLS, schoolId, ["section"]),
    sectionField(schoolId ? SECTIONS : [], section, { schoolId, grade: undefined }),
  ];
}

function renderBar(scope: Scope = {}, q = "") {
  return render(
    <ListNavigationProvider>
      <ListFilterBar
        basePath={BASE}
        q={q}
        resultCount={5}
        searchLabel="Search teachers"
        searchPlaceholder="Name, email, or school…"
        fields={teacherFields(scope)}
        sort={{ value: "alphabetical", options: SORTS }}
      />
    </ListNavigationProvider>
  );
}

/** The href of the single navigation the last interaction caused, parsed. */
function lastNavigation(): { path: string; params: URLSearchParams } {
  expect(push).toHaveBeenCalledTimes(1);
  const href = push.mock.calls[0][0] as string;
  const [path, qs = ""] = href.split("?");
  return { path, params: new URLSearchParams(qs) };
}

function pick(fieldId: string, optionText: string) {
  fireEvent.click(document.getElementById(fieldId) as HTMLElement);
  const listbox = screen.getByRole("listbox");
  fireEvent.click(within(listbox).getByText(optionText));
}

beforeEach(() => {
  vi.clearAllMocks();
  currentQuery = "";
});

afterEach(cleanup);

describe("ListFilterBar — changing a filter", () => {
  it("resets page to 1 by dropping the page param", () => {
    currentQuery = "page=4&sort=school";
    renderBar();
    pick("filter-district", "Alamada");

    const { path, params } = lastNavigation();
    expect(path).toBe(BASE);
    expect(params.get("district")).toBe("Alamada");
    expect(params.has("page")).toBe(false);
    expect(params.get("sort")).toBe("school");
  });

  it("resets page to 1 when a new search is entered, and keeps the filters", () => {
    currentQuery = "page=3&district=Alamada";
    renderBar({ district: "Alamada" });

    const input = screen.getByRole("searchbox", { name: "Search teachers" });
    fireEvent.change(input, { target: { value: "cruz" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const { params } = lastNavigation();
    expect(params.get("q")).toBe("cruz");
    expect(params.get("district")).toBe("Alamada");
    expect(params.has("page")).toBe(false);
  });

  it("changing the district clears the school and section", () => {
    currentQuery = "district=Alamada&schoolId=s1&section=sec1&page=2";
    renderBar({ district: "Alamada", schoolId: "s1", section: "sec1" });
    pick("filter-district", "Banga");

    const { params } = lastNavigation();
    expect(params.get("district")).toBe("Banga");
    expect(params.has("schoolId")).toBe(false);
    expect(params.has("section")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("changing the school clears only the section, keeping the district", () => {
    currentQuery = "district=Alamada&schoolId=s1&section=sec1";
    renderBar({ district: "Alamada", schoolId: "s1", section: "sec1" });
    pick("filter-schoolId", "Rizal CES");

    const { params } = lastNavigation();
    expect(params.get("schoolId")).toBe("s2");
    expect(params.has("section")).toBe(false);
    expect(params.get("district")).toBe("Alamada");
  });

  it("choosing 'All districts' removes the param instead of writing an empty value", () => {
    currentQuery = "district=Alamada&schoolId=s1";
    renderBar({ district: "Alamada", schoolId: "s1" });
    pick("filter-district", "All districts");

    const { params } = lastNavigation();
    expect(params.has("district")).toBe(false);
    expect(params.has("schoolId")).toBe(false);
  });

  it("keeps the search text when a filter changes", () => {
    currentQuery = "q=cruz";
    renderBar({}, "cruz");
    pick("filter-district", "Alamada");

    expect(lastNavigation().params.get("q")).toBe("cruz");
  });
});

describe("ListFilterBar — Clear filters", () => {
  it("is absent when nothing is filtered", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
    expect(screen.queryByText("Filtered by")).toBeNull();
  });

  it("clears every filter and the search but keeps the sort", () => {
    currentQuery = "district=Alamada&schoolId=s1&q=cruz&page=3&sort=school";
    renderBar({ district: "Alamada", schoolId: "s1" }, "cruz");
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(`${BASE}?sort=school`);
  });

  it("goes to the bare path when there is no sort to keep", () => {
    currentQuery = "district=Alamada";
    renderBar({ district: "Alamada" });
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));

    expect(push).toHaveBeenCalledWith(BASE);
  });

  it("lists what is filtering, using option labels", () => {
    currentQuery = "district=Alamada&schoolId=s1";
    renderBar({ district: "Alamada", schoolId: "s1" }, "ana");

    expect(screen.getByText("Filtered by")).not.toBeNull();
    expect(screen.getByText("District: Alamada")).not.toBeNull();
    expect(screen.getByText("School: Naidas T. Opong ES")).not.toBeNull();
    expect(screen.getByText("Search: “ana”")).not.toBeNull();
  });
});

describe("ListFilterBar — the section control", () => {
  it("is disabled, with its reason shown, until a school is chosen", () => {
    renderBar({ district: "Alamada" });
    const section = document.getElementById("filter-section") as HTMLButtonElement;

    expect(section.disabled).toBe(true);
    expect(screen.getByText("Choose a school first.")).not.toBeNull();
  });

  it("does not navigate when a disabled section control is clicked", () => {
    renderBar();
    fireEvent.click(document.getElementById("filter-section") as HTMLElement);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("is enabled once a school is chosen, and picking a section sets it", () => {
    currentQuery = "schoolId=s1&page=2";
    renderBar({ schoolId: "s1" });
    const section = document.getElementById("filter-section") as HTMLButtonElement;

    expect(section.disabled).toBe(false);
    expect(screen.queryByText("Choose a school first.")).toBeNull();

    pick("filter-section", "Rizal");
    const { params } = lastNavigation();
    expect(params.get("section")).toBe("sec1");
    expect(params.get("schoolId")).toBe("s1");
    expect(params.has("page")).toBe(false);
  });

  it("shows a stale section as unselected when no school is chosen", () => {
    renderBar({ section: "sec1" });
    expect((document.getElementById("filter-section") as HTMLElement).textContent).toContain("All sections");
  });
});
