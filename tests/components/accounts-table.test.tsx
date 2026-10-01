import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_LIST_SORTS } from "@/lib/admin/accounts";
import { districtField } from "@/components/admin/management/filter-fields";

/**
 * The Super Admin accounts table: one table per role (Teachers, School Heads,
 * District Admins, Admin Accounts). It must display the surname-first
 * `listingName`, never the denormalized `fullName` (same consistency rule as
 * `TeachersActiveTable`'s Name column), render the "Sort by" control wired to
 * keep the other filters while dropping `page`, and show only the columns that
 * make sense for the one role it lists — no Role column anywhere, a School
 * column for teachers and heads, a Districts column for district admins.
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/accounts", () => ({
  revealSchoolHeadPassword: vi.fn(),
  resetSchoolHeadPasswordToDefault: vi.fn(),
  resetTeacherPassword: vi.fn(),
  resetDistrictAdminPassword: vi.fn(),
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
  districtAdminDistricts: null,
  canRecoverByEmail: true,
};

const DISTRICT_ADMIN_ROW: AccountRowType = {
  ...ROW,
  id: "user-2",
  role: "DISTRICT_ADMIN",
  fullName: "Ramon Dela Cruz",
  listingName: "Dela Cruz, Ramon",
  schoolId: null,
  school: null,
  signIn: { kind: "username", value: "rdelacruz" },
  districtAdminDistricts: ["Alamada", "Banga"],
};

const LIST = {
  page: 1,
  pageSize: 20,
  totalPages: 1,
  totalCount: 1,
  q: "",
};

const TEACHERS = { role: "TEACHER" as const, basePath: "/admin/management/teachers", filters: [] };

beforeEach(() => {
  vi.clearAllMocks();
  currentQuery = "";
});

afterEach(cleanup);

function headers(): string[] {
  return screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
}

describe("AccountsTable — Name column", () => {
  it("renders listingName (surname-first), not fullName", () => {
    render(<AccountsTable rows={[ROW]} list={LIST} {...TEACHERS} />);

    expect(screen.getAllByText("Cruz, Marivic Santos").length).toBeGreaterThan(0);
    expect(screen.queryByText("Marivic Santos Cruz")).toBeNull();
  });
});

describe("AccountsTable — columns per role", () => {
  it("has no Role column on a one-role page, and a School column for teachers", () => {
    render(<AccountsTable rows={[ROW]} list={LIST} {...TEACHERS} />);
    const h = headers();
    expect(h).not.toContain("Role");
    expect(h).toContain("School");
    expect(h).not.toContain("Districts");
    expect(h).toEqual(["Name", "School", "Email / sign-in", "Status", "Password", "Actions"]);
  });

  it("has no Role column and a School column for School Heads", () => {
    render(
      <AccountsTable
        rows={[{ ...ROW, role: "SCHOOL_HEAD" }]}
        list={LIST}
        role="SCHOOL_HEAD"
        basePath="/admin/management/school-heads"
        filters={[]}
      />
    );
    expect(headers()).not.toContain("Role");
    expect(headers()).toContain("School");
  });

  it("shows a Districts column, not School, for District Admins", () => {
    render(
      <AccountsTable
        rows={[DISTRICT_ADMIN_ROW]}
        list={LIST}
        role="DISTRICT_ADMIN"
        basePath="/admin/management/district-admins"
        filters={[]}
      />
    );
    const h = headers();
    expect(h).toContain("Districts");
    expect(h).not.toContain("School");
    expect(h).not.toContain("Role");
    expect(screen.getAllByText("Alamada, Banga").length).toBeGreaterThan(0);
  });

  it("says so when a District Admin has no district assigned", () => {
    render(
      <AccountsTable
        rows={[{ ...DISTRICT_ADMIN_ROW, districtAdminDistricts: [] }]}
        list={LIST}
        role="DISTRICT_ADMIN"
        basePath="/admin/management/district-admins"
        filters={[]}
      />
    );
    expect(screen.getAllByText("No district assigned").length).toBeGreaterThan(0);
  });

  it("has neither School nor Districts nor Role on the Admin Accounts page", () => {
    render(
      <AccountsTable
        rows={[{ ...ROW, role: "SUPER_ADMIN", school: null, schoolId: null }]}
        list={LIST}
        role="SUPER_ADMIN"
        basePath="/admin/admin-accounts"
        filters={[]}
      />
    );
    expect(headers()).toEqual(["Name", "Email / sign-in", "Status", "Password", "Actions"]);
  });

  it("titles the table with the role's plural and the total count", () => {
    render(<AccountsTable rows={[ROW]} list={{ ...LIST, totalCount: 1234 }} {...TEACHERS} />);
    expect(screen.getByRole("heading", { name: /Teachers/ }).textContent).toContain("1,234");
  });

  it("labels the search box for the role", () => {
    render(<AccountsTable rows={[ROW]} list={LIST} {...TEACHERS} />);
    expect(screen.getByRole("searchbox", { name: "Search teachers" })).not.toBeNull();
  });
});

describe("AccountsTable — Sort by", () => {
  const baseList = { ...LIST, q: "cruz" };

  it("renders the Sort by control when list carries sort + sortOptions", () => {
    render(
      <AccountsTable
        rows={[ROW]}
        list={{ ...baseList, sort: "alphabetical", sortOptions: ACCOUNT_LIST_SORTS.options }}
        {...TEACHERS}
      />
    );
    expect(screen.getByLabelText("Sort by")).not.toBeNull();
  });

  it("omits the Sort by control when list has no sort info", () => {
    render(<AccountsTable rows={[ROW]} list={baseList} {...TEACHERS} />);
    expect(screen.queryByLabelText("Sort by")).toBeNull();
  });

  it("choosing a different sort preserves the search and active filters and drops page", async () => {
    currentQuery = "page=3&district=Alamada";
    render(
      <AccountsTable
        rows={[ROW]}
        list={{
          ...baseList,
          page: 3,
          sort: "alphabetical",
          sortOptions: ACCOUNT_LIST_SORTS.options,
        }}
        role="TEACHER"
        basePath="/admin/management/teachers"
        filters={[districtField([{ district: "Alamada", schools: 4 }], "Alamada")]}
      />
    );

    fireEvent.click(screen.getByLabelText("Sort by"));
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText("Date added"));

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    expect(href.startsWith("/admin/management/teachers?")).toBe(true);
    expect(href).toContain("sort=date-added");
    expect(href).toContain("q=cruz");
    expect(href).toContain("district=Alamada");
    expect(href).not.toContain("page=");
    // The role is fixed by the page; it never rides along in the URL.
    expect(href).not.toContain("role=");
  });
});
