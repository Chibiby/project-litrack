import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * The Management accounts pages (Teachers, School Heads, District Admins) wrap
 * their data-fetching subtree in a `<Suspense key={...}>` keyed by
 * `listKey(searchParams, ACCOUNTS_LIST_KEYS)`. Without that key the boundary
 * never re-suspends on a same-route searchParam change, so the skeleton
 * fallback never appears — this proves the key actually reacts to the params
 * that change which rows are shown, and ignores everything else.
 *
 * `AccountsListBody` is an async Server Component and is not exported, so the
 * page's own returned element tree is walked to the `Suspense` element instead
 * and its `key` prop is read directly (same constraint
 * `schools-page-sort-wiring.test.ts` documents).
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => unknown) => fn(),
}));

const admin = {
  role: "SUPER_ADMIN",
  fullName: "Admin Person",
  email: "admin@example.test",
};
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => admin),
  requireDeveloperAdminPage: vi.fn(async () => admin),
}));

const { default: TeachersPage, ACCOUNTS_LIST_KEYS } = await import(
  "@/app/admin/management/teachers/page"
);
const { default: SchoolHeadsPage } = await import("@/app/admin/management/school-heads/page");
const { default: DistrictAdminsPage } = await import("@/app/admin/management/district-admins/page");

type PageFn = (props: { searchParams: Promise<Record<string, string | undefined>> }) => Promise<ReactElement>;

/**
 * Page -> `<RoleAccountsPage>` element -> call it -> `<AdminPage>` element, whose
 * last child is the list's `Suspense` (the summary Suspense, when present, is first).
 */
async function suspenseElementOf(page: PageFn, searchParams: Record<string, string | undefined>) {
  const roleElement = await page({ searchParams: Promise.resolve(searchParams) });
  const adminPage = (await (roleElement.type as (props: unknown) => Promise<ReactElement>)(
    roleElement.props
  )) as ReactElement;
  const children = (adminPage.props as { children: ReactElement | ReactElement[] }).children;
  const list = Array.isArray(children) ? children[children.length - 1] : children;
  return list;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Management accounts pages — Suspense boundary key", () => {
  it("declares exactly the list-affecting params", () => {
    expect(ACCOUNTS_LIST_KEYS).toEqual(["page", "sort", "role", "schoolId", "grade", "district", "section"]);
  });

  it("does not change when the search text (q) changes, so the search box is not remounted", async () => {
    const before = await suspenseElementOf(TeachersPage, { q: "cruz" });
    const after = await suspenseElementOf(TeachersPage, { q: "santos" });

    expect(before.key).toBe(after.key);
    expect(ACCOUNTS_LIST_KEYS).not.toContain("q");
  });

  it("changes when page, sort, school, grade, district or section change", async () => {
    const base = await suspenseElementOf(TeachersPage, {});

    for (const changed of [
      { page: "2" },
      { sort: "date-added" },
      { schoolId: "school-1" },
      { grade: "G3" },
      { district: "Alamada" },
      { section: "sec-1" },
    ]) {
      const el = await suspenseElementOf(TeachersPage, changed);
      expect(el.key, JSON.stringify(changed)).not.toBe(base.key);
    }
  });

  it("re-suspends the list on every role's page when the district changes", async () => {
    for (const page of [TeachersPage, SchoolHeadsPage, DistrictAdminsPage]) {
      const base = await suspenseElementOf(page, {});
      const byDistrict = await suspenseElementOf(page, { district: "Alamada" });
      expect(byDistrict.key).not.toBe(base.key);
    }
  });

  it("does NOT change when an unrelated param changes", async () => {
    // `view` stands in for a param that does not affect which rows show.
    expect(ACCOUNTS_LIST_KEYS).not.toContain("view");

    const before = await suspenseElementOf(TeachersPage, { q: "cruz", view: "grid" });
    const after = await suspenseElementOf(TeachersPage, { q: "cruz", view: "list" });

    expect(before.key).toBe(after.key);
  });
});
