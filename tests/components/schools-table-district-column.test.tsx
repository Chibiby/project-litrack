import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * District portal usage of the Schools table (`columns: "district"`): the
 * District column repeats the same value on every row when the admin's whole
 * scope is one district, so it is hidden in that case — decided by the
 * `singleDistrict` prop the page computes from its scope, never from the rows
 * on the current page.
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/district/schools",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/school", () => ({
  deleteSchool: vi.fn(),
  regenerateSchoolHeadCredential: vi.fn(),
}));

vi.mock("@/lib/actions/school-management", () => ({
  setSchoolActive: vi.fn(),
}));

const { SchoolsTable } = await import("@/components/schools-table");
type Row = Parameters<typeof SchoolsTable>[0]["schools"][number];

const SCHOOL: Row = {
  id: "school-1",
  name: "Maitum Central ES",
  schoolIdCode: "130554",
  region: null,
  division: null,
  district: "Maitum 2",
  isActive: true,
  isDemo: false,
};

const LIST = {
  page: 1,
  totalPages: 1,
  totalCount: 1,
  pageSize: 10,
  q: "",
  region: "",
  status: "" as const,
};

const districtCapabilities = {
  toggleActive: true,
  resetHead: true,
  edit: true,
  delete: false,
  openAsSchoolHead: false,
  columns: "district" as const,
  basePath: "/district/schools",
  emptyMessage: "No school matches your search.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("SchoolsTable — district column", () => {
  it("shows the District column when the admin's scope spans several districts", () => {
    render(
      <SchoolsTable
        schools={[SCHOOL]}
        list={LIST}
        capabilities={{ ...districtCapabilities, singleDistrict: false }}
      />
    );
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getByRole("columnheader", { name: "District" })).toBeTruthy();
    expect(within(table).getByText("Maitum 2")).toBeTruthy();
  });

  it("hides the District column when singleDistrict is true", () => {
    render(
      <SchoolsTable
        schools={[SCHOOL]}
        list={LIST}
        capabilities={{ ...districtCapabilities, singleDistrict: true }}
      />
    );
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).queryByRole("columnheader", { name: "District" })).toBeNull();
    expect(within(table).queryByText("Maitum 2")).toBeNull();
    // The mobile card list must not print a "District" field either.
    expect(screen.queryByText("District")).toBeNull();
  });

  it("still shows Region/Division for the Super Admin's admin columns regardless of singleDistrict", () => {
    render(
      <SchoolsTable
        schools={[{ ...SCHOOL, region: "Region XII", division: "Sarangani", users: 5, learners: 40 }]}
        list={LIST}
      />
    );
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getByRole("columnheader", { name: "Region" })).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "District" })).toBeNull();
  });
});
