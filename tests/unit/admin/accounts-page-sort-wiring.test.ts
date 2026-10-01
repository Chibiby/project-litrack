import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { ACCOUNT_LIST_SORTS } from "@/lib/admin/accounts";

/**
 * A one-role accounts page offers only the sorts that mean something there:
 * "Role" is never offered (every row has the same role), and "School" is not
 * offered where rows have no school (District Admins, Admin Accounts). A
 * bookmarked or hand-edited `?sort=` the dropdown does not list must fall back
 * to the default sort — in the dropdown's selected value AND in the query that
 * orders the rows — rather than ordering by something the user cannot see.
 *
 * The async list body is not exported, so the page's element tree is walked to
 * it and the body is called directly (see accounts-page-list-key.test.ts).
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cache/unstable", () => ({ cachedQuery: (fn: () => unknown) => fn() }));

const admin = { role: "SUPER_ADMIN", fullName: "Admin Person", email: "admin@example.test" };
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => admin),
  requireDeveloperAdminPage: vi.fn(async () => admin),
}));

const emptyPage = { rows: [], totalCount: 0 };
const getTeachersPage = vi.fn(async (..._a: unknown[]) => emptyPage);
const getSchoolHeadsPage = vi.fn(async (..._a: unknown[]) => emptyPage);
const getDistrictAdminsPage = vi.fn(async (..._a: unknown[]) => emptyPage);
vi.mock("@/lib/admin/management", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/admin/management")>()),
  getTeachersPage: (...a: unknown[]) => getTeachersPage(...a),
  getSchoolHeadsPage: (...a: unknown[]) => getSchoolHeadsPage(...a),
  getDistrictAdminsPage: (...a: unknown[]) => getDistrictAdminsPage(...a),
  getTeachersSummary: vi.fn(async () => ({})),
  getSchoolHeadsSummary: vi.fn(async () => ({})),
  getDistrictAdminsSummary: vi.fn(async () => ({})),
  listDistrictOptions: vi.fn(async () => []),
  listSchoolOptions: vi.fn(async () => []),
  listSectionOptions: vi.fn(async () => []),
}));

const getAccountsPage = vi.fn(async (..._a: unknown[]) => emptyPage);
vi.mock("@/lib/admin/accounts", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/admin/accounts")>()),
  getAccountsPage: (...a: unknown[]) => getAccountsPage(...a),
}));

const { default: TeachersPage } = await import("@/app/admin/management/teachers/page");
const { default: SchoolHeadsPage } = await import("@/app/admin/management/school-heads/page");
const { default: DistrictAdminsPage } = await import("@/app/admin/management/district-admins/page");
const { default: AdminAccountsPage } = await import("@/app/admin/admin-accounts/page");

type PageFn = (props: { searchParams: Promise<Record<string, string | undefined>> }) => Promise<ReactElement>;
type Call = (props: unknown) => Promise<ReactElement>;

/** The `list` prop the page hands to `AccountsTable`, plus nothing else of the tree. */
async function tableListOf(page: PageFn, searchParams: Record<string, string | undefined>) {
  const roleElement = await page({ searchParams: Promise.resolve(searchParams) });
  const adminPage = await (roleElement.type as Call)(roleElement.props);
  const children = (adminPage.props as { children: ReactElement | ReactElement[] }).children;
  const suspense = Array.isArray(children) ? children[children.length - 1] : children;
  const body = (suspense.props as { children: ReactElement }).children;
  const bodyOut = await (body.type as Call)(body.props);
  // The body renders a fragment: [maybeError, <AccountsTable />].
  const parts = (bodyOut.props as { children: ReactElement[] }).children;
  const table = parts[parts.length - 1];
  return (table.props as { list: { sort: string; sortOptions: { value: string }[] } }).list;
}

const values = (list: { sortOptions: { value: string }[] }) => list.sortOptions.map((o) => o.value);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("one-role accounts pages — sort options", () => {
  it("never offer Role", async () => {
    for (const page of [TeachersPage, SchoolHeadsPage, DistrictAdminsPage, AdminAccountsPage]) {
      expect(values(await tableListOf(page, {}))).not.toContain("role");
    }
  });

  it("Teachers and School Heads offer School; District Admins and Admin Accounts do not", async () => {
    expect(values(await tableListOf(TeachersPage, {}))).toContain("school");
    expect(values(await tableListOf(SchoolHeadsPage, {}))).toContain("school");
    expect(values(await tableListOf(DistrictAdminsPage, {}))).not.toContain("school");
    expect(values(await tableListOf(AdminAccountsPage, {}))).not.toContain("school");
  });

  it("keep alphabetical, date added and status everywhere", async () => {
    for (const page of [TeachersPage, SchoolHeadsPage, DistrictAdminsPage, AdminAccountsPage]) {
      expect(values(await tableListOf(page, {}))).toEqual(
        expect.arrayContaining(["alphabetical", "date-added", "status"])
      );
    }
  });
});

describe("one-role accounts pages — an unlisted sort falls back to the default", () => {
  const DEFAULT = ACCOUNT_LIST_SORTS.parse(undefined);

  it("the default is alphabetical", () => {
    expect(DEFAULT).toBe("alphabetical");
  });

  it("sort=role falls back on every page", async () => {
    for (const page of [TeachersPage, SchoolHeadsPage, DistrictAdminsPage, AdminAccountsPage]) {
      expect((await tableListOf(page, { sort: "role" })).sort).toBe(DEFAULT);
    }
  });

  it("sort=school falls back where rows have no school, and is kept where they do", async () => {
    expect((await tableListOf(DistrictAdminsPage, { sort: "school" })).sort).toBe(DEFAULT);
    expect((await tableListOf(AdminAccountsPage, { sort: "school" })).sort).toBe(DEFAULT);
    expect((await tableListOf(TeachersPage, { sort: "school" })).sort).toBe("school");
    expect((await tableListOf(SchoolHeadsPage, { sort: "school" })).sort).toBe("school");
  });

  it("a garbage sort falls back", async () => {
    expect((await tableListOf(TeachersPage, { sort: "not-a-sort" })).sort).toBe(DEFAULT);
  });

  it("a listed sort is kept", async () => {
    expect((await tableListOf(DistrictAdminsPage, { sort: "status" })).sort).toBe("status");
    expect((await tableListOf(TeachersPage, { sort: "date-added" })).sort).toBe("date-added");
  });

  it("the query that orders the rows gets the fallback too, not the unlisted sort", async () => {
    await tableListOf(TeachersPage, { sort: "role" });
    expect(getTeachersPage.mock.calls[0][0]).toMatchObject({ sort: DEFAULT, role: "TEACHER" });

    await tableListOf(DistrictAdminsPage, { sort: "school" });
    expect(getDistrictAdminsPage.mock.calls[0][0]).toMatchObject({ sort: DEFAULT, role: "DISTRICT_ADMIN" });

    await tableListOf(AdminAccountsPage, { sort: "role" });
    expect(getAccountsPage.mock.calls[0][0]).toMatchObject({ sort: DEFAULT, role: "SUPER_ADMIN" });
  });

  it("a listed sort reaches the query unchanged", async () => {
    await tableListOf(SchoolHeadsPage, { sort: "school" });
    expect(getSchoolHeadsPage.mock.calls[0][0]).toMatchObject({ sort: "school" });
  });
});
