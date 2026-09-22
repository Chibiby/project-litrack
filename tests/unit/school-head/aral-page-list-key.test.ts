import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { listKey } from "@/lib/nav/list-params";

/**
 * `/school-head/aral` wraps its paginated table body in a `<Suspense key={...}>`
 * keyed by `listKey(searchParams, ARAL_LEARNERS_LIST_KEYS)` — there was no
 * Suspense boundary around the table at all before this change (the whole
 * page awaited one combined query), so this also proves one now exists.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
  },
}));

vi.mock("@/lib/teachers/aral-tutor", () => ({
  listAralTutors: vi.fn(async () => []),
}));

vi.mock("@/lib/school-head/view", () => ({
  resolveSchoolHeadView: vi.fn(async () => ({
    user: { id: "head-1" },
    view: { schoolId: "school-1", schoolName: null, isSuperAdminView: false },
  })),
}));

const { default: SchoolHeadAralPage, ARAL_LEARNERS_LIST_KEYS } = await import(
  "@/app/school-head/(app)/aral/page"
);

/** Walk the page's returned tree to the keyed `Suspense` wrapping the table body. */
function suspenseElementOf(pageElement: ReactElement): ReactElement {
  return (pageElement.props as { children: ReactElement }).children;
}

describe("School Head ARAL page — Suspense boundary key", () => {
  it("declares exactly the list-affecting params", () => {
    expect(ARAL_LEARNERS_LIST_KEYS).toEqual(["page", "sort", "q"]);
  });

  it("changes when a list-affecting param (q) changes", async () => {
    const before = suspenseElementOf(
      await SchoolHeadAralPage({ searchParams: Promise.resolve({ q: "cruz" }) })
    );
    const after = suspenseElementOf(
      await SchoolHeadAralPage({ searchParams: Promise.resolve({ q: "santos" }) })
    );

    expect(before.key).not.toBe(after.key);
    expect(before.key).toBe(listKey({ q: "cruz" }, ARAL_LEARNERS_LIST_KEYS));
  });

  it("changes when page changes", async () => {
    const base = suspenseElementOf(
      await SchoolHeadAralPage({ searchParams: Promise.resolve({}) })
    );
    const byPage = suspenseElementOf(
      await SchoolHeadAralPage({ searchParams: Promise.resolve({ page: "2" }) })
    );

    expect(byPage.key).not.toBe(base.key);
  });

  it("does NOT change when the Super Admin view's schoolId changes", async () => {
    expect(ARAL_LEARNERS_LIST_KEYS).not.toContain("schoolId");

    const before = suspenseElementOf(
      await SchoolHeadAralPage({
        searchParams: Promise.resolve({ q: "cruz", schoolId: "school-1" }),
      })
    );
    const after = suspenseElementOf(
      await SchoolHeadAralPage({
        searchParams: Promise.resolve({ q: "cruz", schoolId: "school-2" }),
      })
    );

    expect(before.key).toBe(after.key);
  });
});
