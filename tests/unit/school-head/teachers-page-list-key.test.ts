import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { listKey } from "@/lib/nav/list-params";

/**
 * `/school-head/teachers` wraps `ActiveTeachersBody` in a `<Suspense key={...}>`
 * keyed by `listKey(searchParams, ACTIVE_TEACHERS_LIST_KEYS)`. Without a
 * matching key React never re-suspends the boundary on a same-route
 * searchParam change, so the skeleton fallback never shows — this proves the
 * key actually reacts to page/sort/q/filter and ignores the Super Admin's
 * `?schoolId=` view-context param.
 */

vi.mock("@/lib/prisma", () => ({
  prismaFresh: {
    user: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 45),
    },
    gradeLevel: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock("@/lib/school-head/view", () => ({
  resolveSchoolHeadView: vi.fn(async () => ({
    user: { id: "head-1" },
    view: { schoolId: "school-1", schoolName: null, isSuperAdminView: false },
  })),
}));

const { default: TeachersPage, ACTIVE_TEACHERS_LIST_KEYS } = await import(
  "@/app/school-head/(app)/teachers/page"
);

/** Walk `TeachersPage`'s returned tree to the keyed `Suspense` element. */
function suspenseElementOf(pageElement: ReactElement): ReactElement {
  return (pageElement.props as { children: ReactElement }).children;
}

describe("Teachers page — Suspense boundary key", () => {
  it("declares exactly the list-affecting params", () => {
    expect(ACTIVE_TEACHERS_LIST_KEYS).toEqual(["page", "sort", "q", "filter"]);
  });

  it("changes when a list-affecting param (q) changes", async () => {
    const before = suspenseElementOf(
      await TeachersPage({ searchParams: Promise.resolve({ q: "cruz" }) })
    );
    const after = suspenseElementOf(
      await TeachersPage({ searchParams: Promise.resolve({ q: "santos" }) })
    );

    expect(before.key).not.toBe(after.key);
    expect(before.key).toBe(listKey({ q: "cruz" }, ACTIVE_TEACHERS_LIST_KEYS));
  });

  it("changes when page, sort, or filter change", async () => {
    const base = suspenseElementOf(
      await TeachersPage({ searchParams: Promise.resolve({}) })
    );
    const byPage = suspenseElementOf(
      await TeachersPage({ searchParams: Promise.resolve({ page: "2" }) })
    );
    const bySort = suspenseElementOf(
      await TeachersPage({ searchParams: Promise.resolve({ sort: "date-added" }) })
    );
    const byFilter = suspenseElementOf(
      await TeachersPage({ searchParams: Promise.resolve({ filter: "teacher" }) })
    );

    expect(byPage.key).not.toBe(base.key);
    expect(bySort.key).not.toBe(base.key);
    expect(byFilter.key).not.toBe(base.key);
  });

  it("does NOT change when the Super Admin view's schoolId changes", async () => {
    expect(ACTIVE_TEACHERS_LIST_KEYS).not.toContain("schoolId");

    const before = suspenseElementOf(
      await TeachersPage({
        searchParams: Promise.resolve({ q: "cruz", schoolId: "school-1" }),
      })
    );
    const after = suspenseElementOf(
      await TeachersPage({
        searchParams: Promise.resolve({ q: "cruz", schoolId: "school-2" }),
      })
    );

    expect(before.key).toBe(after.key);
  });
});
