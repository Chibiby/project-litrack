import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_LIST_SORTS } from "@/lib/admin/accounts";

/**
 * The Super Admin accounts table: it must display the surname-first
 * `listingName`, never the denormalized `fullName` (same consistency rule as
 * `TeachersActiveTable`'s Name column — a table ordered surname-first but
 * displaying `fullName` looks unsorted), and — once a `list` with
 * `sort`/`sortOptions` is passed — it renders the "Sort by" control and wires
 * it to preserve the other filters while dropping `page`.
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/accounts",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/accounts", () => ({
  revealSchoolHeadPassword: vi.fn(),
  resetSchoolHeadPasswordToDefault: vi.fn(),
  resetTeacherPassword: vi.fn(),
  impersonateUser: vi.fn(),
}));

const { AccountsTable } = await import("@/components/admin/accounts-table");
type AccountRowType = Parameters<typeof AccountsTable>[0]["rows"][number];

const ROW: AccountRowType = {
  id: "user-1",
  role: "TEACHER",
  fullName: "Marivic Santos Cruz",
  listingName: "Cruz, Marivic Santos",
  avatarPath: null,
  schoolId: "school-1",
  school: { id: "school-1", name: "Naidas T. Opong ES", schoolIdCode: "130554" },
  signIn: { kind: "email", value: "marivic@example.test", synthetic: false },
  isActive: true,
  mustChangePassword: false,
  approvalStatus: null,
  password: { kind: "never_stored" },
  signInHead: false,
  canRecoverByEmail: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("AccountsTable — Name column", () => {
  it("renders listingName (surname-first), not fullName", () => {
    render(
      <AccountsTable
        rows={[ROW]}
        list={{
          page: 1,
          pageSize: 20,
          totalPages: 1,
          totalCount: 1,
          role: "",
          schoolId: "",
          q: "",
        }}
      />
    );

    expect(screen.getAllByText("Cruz, Marivic Santos").length).toBeGreaterThan(0);
    expect(screen.queryByText("Marivic Santos Cruz")).toBeNull();
  });
});

describe("AccountsTable — Sort by", () => {
  const baseList = {
    page: 1,
    pageSize: 20,
    totalPages: 1,
    totalCount: 1,
    role: "TEACHER",
    schoolId: "",
    q: "cruz",
  };

  it("renders the Sort by control when list carries sort + sortOptions", () => {
    render(
      <AccountsTable
        rows={[ROW]}
        list={{ ...baseList, sort: "alphabetical", sortOptions: ACCOUNT_LIST_SORTS.options }}
      />
    );
    expect(screen.getByLabelText("Sort by")).not.toBeNull();
  });

  it("omits the Sort by control when list has no sort info", () => {
    render(<AccountsTable rows={[ROW]} list={baseList} />);
    expect(screen.queryByLabelText("Sort by")).toBeNull();
  });

  it("choosing a different sort preserves the other filters (q, role) and drops page", async () => {
    render(
      <AccountsTable
        rows={[ROW]}
        list={{
          ...baseList,
          page: 3,
          sort: "alphabetical",
          sortOptions: ACCOUNT_LIST_SORTS.options,
        }}
      />
    );

    fireEvent.click(screen.getByLabelText("Sort by"));
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText("Date added"));

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("sort=date-added");
    expect(href).toContain("q=cruz");
    expect(href).toContain("role=TEACHER");
    expect(href).not.toContain("page=");
  });
});
