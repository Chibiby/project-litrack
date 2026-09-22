import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { listKey } from "@/lib/nav/list-params";

/**
 * `/admin/schools` wraps its data-fetching subtree in a `<Suspense key={...}>`
 * keyed by `listKey(searchParams, SCHOOLS_LIST_KEYS)`. Without that key the
 * boundary never re-suspends on a same-route searchParam change, so the
 * skeleton fallback never appears — this proves the key actually reacts to
 * the params that change which rows are shown, and ignores everything else.
 * Mirrors `accounts-page-list-key.test.ts`; see `schools-page-sort-wiring.test.ts`
 * for why the page element tree is walked instead of rendered.
 */

const findMany = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const count = vi.fn(async (..._args: unknown[]) => 0);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findMany: (...args: unknown[]) => findMany(...(args as [])),
      count: (...args: unknown[]) => count(...(args as [])),
    },
  },
}));

vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    role: "SUPER_ADMIN",
    fullName: "Admin Person",
    email: "admin@example.test",
  })),
}));

const { default: SchoolsListPage, SCHOOLS_LIST_KEYS } = await import(
  "@/app/admin/schools/page"
);

/** Walk `SchoolsListPage`'s returned tree to its `Suspense` element. */
function suspenseElementOf(pageElement: ReactElement): ReactElement {
  const children = (pageElement.props as { children: ReactElement[] }).children;
  return children[children.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
});

describe("SchoolsListPage — Suspense boundary key", () => {
  it("declares exactly the list-affecting params", () => {
    expect(SCHOOLS_LIST_KEYS).toEqual(["page", "sort", "q", "region", "status"]);
  });

  it("changes when a list-affecting param (q) changes", async () => {
    const before = suspenseElementOf(
      await SchoolsListPage({ searchParams: Promise.resolve({ q: "naidas" }) })
    );
    const after = suspenseElementOf(
      await SchoolsListPage({ searchParams: Promise.resolve({ q: "opong" }) })
    );

    expect(before.key).not.toBe(after.key);
    expect(before.key).toBe(listKey({ q: "naidas" }, SCHOOLS_LIST_KEYS));
    expect(after.key).toBe(listKey({ q: "opong" }, SCHOOLS_LIST_KEYS));
  });

  it("changes when page, sort, region, or status change", async () => {
    const base = suspenseElementOf(
      await SchoolsListPage({ searchParams: Promise.resolve({}) })
    );

    const byPage = suspenseElementOf(
      await SchoolsListPage({ searchParams: Promise.resolve({ page: "2" }) })
    );
    const bySort = suspenseElementOf(
      await SchoolsListPage({ searchParams: Promise.resolve({ sort: "learners" }) })
    );
    const byRegion = suspenseElementOf(
      await SchoolsListPage({ searchParams: Promise.resolve({ region: "NCR" }) })
    );
    const byStatus = suspenseElementOf(
      await SchoolsListPage({ searchParams: Promise.resolve({ status: "active" }) })
    );

    expect(byPage.key).not.toBe(base.key);
    expect(bySort.key).not.toBe(base.key);
    expect(byRegion.key).not.toBe(base.key);
    expect(byStatus.key).not.toBe(base.key);
  });

  it("does NOT change when an unrelated param changes", async () => {
    // `schoolId` stands in for a param that does not affect which rows show
    // on this list (unlike the accounts list, where it is a filter). It must
    // be absent from SCHOOLS_LIST_KEYS.
    expect(SCHOOLS_LIST_KEYS).not.toContain("schoolId");

    const before = suspenseElementOf(
      await SchoolsListPage({
        searchParams: Promise.resolve({ q: "naidas", schoolId: "a" } as never),
      })
    );
    const after = suspenseElementOf(
      await SchoolsListPage({
        searchParams: Promise.resolve({ q: "naidas", schoolId: "b" } as never),
      })
    );

    expect(before.key).toBe(after.key);
  });
});
