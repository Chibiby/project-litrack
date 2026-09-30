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
  usePathname: () => "/admin/schools",
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
    expect(screen.getAllByText(/No schools match your search or filters/).length).toBeGreaterThan(0);
    const link = screen.getAllByRole("link", { name: "Clear filters" })[0]!;
    expect(link.getAttribute("href")).toBe("/admin/schools");
  });

  it("shows the create prompt, not a filter message, when no school exists", () => {
    render(<SchoolsTable schools={[]} list={SCHOOLS_LIST} />);
    expect(screen.getAllByText(/Create your first school/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/match your search or filters/)).toBeNull();
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
  const list = { page: 1, pageSize: 20, totalPages: 1, totalCount: 0, role: "", schoolId: "", q: "" };

  it("offers Clear filters when the filters excluded every account", () => {
    render(<AccountsTable rows={[]} list={{ ...list, q: "nobody" }} />);
    expect(screen.getByText("No accounts match your search or filters.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Clear filters" }).getAttribute("href")).toBe(
      "/admin/accounts"
    );
  });

  it("points to creating a school when no account exists at all", () => {
    render(<AccountsTable rows={[]} list={list} />);
    expect(screen.getByText("No accounts yet")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Create a school" }).getAttribute("href")).toBe(
      "/admin/schools/new"
    );
    expect(screen.queryByText(/match your search or filters/)).toBeNull();
  });
});
