import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * "Nothing exists" and "your filters excluded everything" are different
 * situations and must not read the same: the filtered one offers a way back to
 * the unfiltered list, the other offers to create the first record.
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
  usePathname: () => "/admin/management/schools",
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

vi.mock("@/lib/actions/accounts", () => ({
  revealSchoolHeadPassword: vi.fn(),
  resetSchoolHeadPasswordToDefault: vi.fn(),
  resetTeacherPassword: vi.fn(),
  impersonateUser: vi.fn(),
}));

const { SchoolsTable } = await import("@/components/schools-table");
const { AccountsTable } = await import("@/components/admin/accounts-table");
const { districtField, schoolField } = await import("@/components/admin/management/filter-fields");

afterEach(cleanup);

const SCHOOLS_LIST = {
  page: 1,
  totalPages: 1,
  totalCount: 0,
  pageSize: 10,
  q: "",
  region: "",
  status: "" as const,
};

describe("SchoolsTable empty states", () => {
  it("offers Clear filters when a search excluded every school", () => {
    render(<SchoolsTable schools={[]} list={{ ...SCHOOLS_LIST, q: "zzz" }} />);
    expect(screen.getAllByText(/No schools match Search: “zzz”/).length).toBeGreaterThan(0);
    const link = screen.getAllByRole("link", { name: "Clear filters" })[0]!;
    expect(link.getAttribute("href")).toBe("/admin/management/schools");
  });

  it("names the district filter, and Clear filters keeps the chosen sort", () => {
    render(
      <SchoolsTable
        schools={[]}
        list={{ ...SCHOOLS_LIST, district: "Alamada", q: "zzz", sort: "alphabetical" }}
      />
    );
    expect(
      screen.getAllByText(/No schools match District: Alamada · Search: “zzz”/).length
    ).toBeGreaterThan(0);
    const link = screen.getAllByRole("link", { name: "Clear filters" })[0]!;
    expect(link.getAttribute("href")).toBe("/admin/management/schools?sort=alphabetical");
  });

  it("shows the create prompt, not a filter message, when no school exists", () => {
    render(<SchoolsTable schools={[]} list={SCHOOLS_LIST} />);
    expect(screen.getAllByText(/Create your first school/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No schools match/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
  });

  it("uses the district wording when no school is assigned", () => {
    render(
      <SchoolsTable
        schools={[]}
        list={SCHOOLS_LIST}
        capabilities={{
          columns: "district",
          basePath: "/district/schools",
          emptyMessage: "No schools are assigned to your district yet.",
        }}
      />
    );
    expect(screen.getAllByText("No schools are assigned to your district yet.").length).toBeGreaterThan(0);
  });
});

describe("AccountsTable empty states", () => {
  const list = { page: 1, pageSize: 20, totalPages: 1, totalCount: 0, q: "" };
  const TEACHERS = { role: "TEACHER" as const, basePath: "/admin/management/teachers" };

  it("offers Clear filters when a search excluded every account, and names the search", () => {
    render(<AccountsTable rows={[]} list={{ ...list, q: "nobody" }} filters={[]} {...TEACHERS} />);
    expect(screen.getByText("No teachers match")).not.toBeNull();
    expect(screen.getByText(/Nothing matches Search: “nobody”/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Clear filters" }).getAttribute("href")).toBe(
      "/admin/management/teachers"
    );
  });

  it("names every active filter in the message, not just the search", () => {
    render(
      <AccountsTable
        rows={[]}
        list={{ ...list, q: "ana" }}
        filters={[
          districtField([{ district: "Alamada", schools: 3 }], "Alamada"),
          schoolField(
            [{ id: "s1", name: "Naidas T. Opong ES", schoolIdCode: "130554", district: "Alamada" }],
            "s1"
          ),
        ]}
        {...TEACHERS}
      />
    );
    const message = screen.getByText(/Nothing matches/).textContent ?? "";
    expect(message).toContain("District: Alamada");
    expect(message).toContain("School: Naidas T. Opong ES");
    expect(message).toContain("Search: “ana”");
  });

  it("treats an active filter with no search as filtered, not as empty", () => {
    render(
      <AccountsTable
        rows={[]}
        list={list}
        filters={[districtField([{ district: "Alamada", schools: 3 }], "Alamada")]}
        {...TEACHERS}
      />
    );
    expect(screen.getByText("No teachers match")).not.toBeNull();
    expect(screen.queryByText("No teachers yet")).toBeNull();
  });

  it("does not count an unset filter as active", () => {
    render(
      <AccountsTable
        rows={[]}
        list={list}
        filters={[districtField([{ district: "Alamada", schools: 3 }], undefined)]}
        {...TEACHERS}
      />
    );
    expect(screen.getByText("No teachers yet")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
  });

  it("points to creating a school when no School Head exists at all", () => {
    render(
      <AccountsTable
        rows={[]}
        list={list}
        filters={[]}
        role="SCHOOL_HEAD"
        basePath="/admin/management/school-heads"
      />
    );
    expect(screen.getByText("No school heads yet")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Create a school" }).getAttribute("href")).toBe(
      "/admin/management/schools/new"
    );
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });

  it("uses the role's own wording for the unfiltered empty state", () => {
    render(<AccountsTable rows={[]} list={list} filters={[]} {...TEACHERS} />);
    expect(screen.getByText("No teachers yet")).not.toBeNull();
    expect(screen.getByText(/Teachers appear here once they register/)).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Create a school" })).toBeNull();
  });
});
