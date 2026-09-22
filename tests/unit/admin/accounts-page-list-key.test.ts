import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { listKey } from "@/lib/nav/list-params";

/**
 * `/admin/accounts` wraps its data-fetching subtree in a `<Suspense key={...}>`
 * keyed by `listKey(searchParams, ACCOUNTS_LIST_KEYS)`. Without that key the
 * boundary never re-suspends on a same-route searchParam change, so the
 * skeleton fallback never appears — this proves the key actually reacts to
 * the params that change which rows are shown, and ignores everything else.
 *
 * `AccountsTableBody` is an async Server Component and is not exported, so
 * rendering through `@testing-library/react` is not available here (same
 * constraint `schools-page-sort-wiring.test.ts` documents for its sibling
 * page). The page's own returned element tree is walked to the `Suspense`
 * element instead, and its `key` prop is read directly.
 */

const findMany = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const count = vi.fn(async (..._args: unknown[]) => 0);
const groupBy = vi.fn(async (..._args: unknown[]) => [] as unknown[]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => findMany(...(args as [])),
      count: (...args: unknown[]) => count(...(args as [])),
      groupBy: (...args: unknown[]) => groupBy(...(args as [])),
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    role: "SUPER_ADMIN",
    fullName: "Admin Person",
    email: "admin@example.test",
  })),
}));

const { default: AdminAccountsPage, ACCOUNTS_LIST_KEYS } = await import(
  "@/app/admin/accounts/page"
);

/** Walk `AdminAccountsPage`'s returned tree to its `Suspense` element. */
function suspenseElementOf(pageElement: ReactElement): ReactElement {
  return (pageElement.props as { children: ReactElement }).children;
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
  groupBy.mockResolvedValue([]);
});

describe("AdminAccountsPage — Suspense boundary key", () => {
  it("declares exactly the list-affecting params", () => {
    expect(ACCOUNTS_LIST_KEYS).toEqual(["page", "sort", "q", "role", "schoolId"]);
  });

  it("changes when a list-affecting param (q) changes", async () => {
    const before = suspenseElementOf(
      await AdminAccountsPage({ searchParams: Promise.resolve({ q: "cruz" }) })
    );
    const after = suspenseElementOf(
      await AdminAccountsPage({ searchParams: Promise.resolve({ q: "santos" }) })
    );

    expect(before.key).not.toBe(after.key);
    expect(before.key).toBe(listKey({ q: "cruz" }, ACCOUNTS_LIST_KEYS));
    expect(after.key).toBe(listKey({ q: "santos" }, ACCOUNTS_LIST_KEYS));
  });

  it("changes when page, sort, role, or schoolId change", async () => {
    const base = suspenseElementOf(
      await AdminAccountsPage({ searchParams: Promise.resolve({}) })
    );

    const byPage = suspenseElementOf(
      await AdminAccountsPage({ searchParams: Promise.resolve({ page: "2" }) })
    );
    const bySort = suspenseElementOf(
      await AdminAccountsPage({ searchParams: Promise.resolve({ sort: "date-added" }) })
    );
    const byRole = suspenseElementOf(
      await AdminAccountsPage({ searchParams: Promise.resolve({ role: "TEACHER" }) })
    );
    const bySchool = suspenseElementOf(
      await AdminAccountsPage({ searchParams: Promise.resolve({ schoolId: "school-1" }) })
    );

    expect(byPage.key).not.toBe(base.key);
    expect(bySort.key).not.toBe(base.key);
    expect(byRole.key).not.toBe(base.key);
    expect(bySchool.key).not.toBe(base.key);
  });

  it("does NOT change when an unrelated param changes", async () => {
    // `view` stands in for a param that does not affect which rows show
    // (e.g. a modal flag). It must be absent from ACCOUNTS_LIST_KEYS.
    expect(ACCOUNTS_LIST_KEYS).not.toContain("view");

    const before = suspenseElementOf(
      await AdminAccountsPage({
        searchParams: Promise.resolve({ q: "cruz", view: "grid" } as never),
      })
    );
    const after = suspenseElementOf(
      await AdminAccountsPage({
        searchParams: Promise.resolve({ q: "cruz", view: "list" } as never),
      })
    );

    expect(before.key).toBe(after.key);
  });
});
