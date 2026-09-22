import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { teacherListOrderBy } from "@/lib/teachers/pagination";

/**
 * Proves the "Sort by" wiring reaches the actual Prisma query, not just the
 * parser. `parseTeachersListParams`/`teacherListOrderBy` already have their
 * own unit coverage (`pagination-sort.test.ts`) — what is untested without
 * this file is whether `page.tsx` actually threads the parsed `sort` into the
 * `findMany` it runs, rather than the `orderBy: { createdAt: "desc" }` it
 * used to hardcode.
 *
 * `ActiveTeachersBody` is an async Server Component and is not exported, so
 * rendering the page through `@testing-library/react` is not available here
 * (same constraint `route-loading-shape.test.tsx` documents for async pages).
 * Instead, the page's own returned element tree is walked to the
 * `ActiveTeachersBody` element `TeachersPage` builds, and that element's
 * function is invoked directly — exactly what React would do when it renders
 * that Suspense boundary, minus the actual DOM commit this test does not need.
 */

const findMany = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const gradeLevelFindMany = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const userCount = vi.fn(async (..._args: unknown[]) => 0);

vi.mock("@/lib/prisma", () => ({
  prismaFresh: {
    user: {
      findMany: (...args: unknown[]) => findMany(...(args as [])),
      count: (...args: unknown[]) => userCount(...(args as [])),
    },
    gradeLevel: {
      findMany: (...args: unknown[]) => gradeLevelFindMany(...(args as [])),
    },
    section: {
      groupBy: vi.fn(async () => [] as unknown[]),
    },
  },
}));

vi.mock("@/lib/school-head/view", () => ({
  resolveSchoolHeadView: vi.fn(async () => ({
    user: { id: "head-1" },
    view: { schoolId: "school-1", schoolName: null, isSuperAdminView: false },
  })),
}));

const { default: TeachersPage } = await import(
  "@/app/school-head/(app)/teachers/page"
);

/** Walk `TeachersPage`'s returned tree to the `ActiveTeachersBody` element. */
function activeTeachersBodyElementOf(pageElement: ReactElement): ReactElement {
  const suspense = (pageElement.props as { children: ReactElement }).children;
  return (suspense.props as { children: ReactElement }).children;
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  gradeLevelFindMany.mockResolvedValue([]);
  userCount.mockResolvedValue(0);
});

describe("TeachersPage — sort reaches the Prisma query", () => {
  it("defaults to the alphabetical orderBy when ?sort is omitted", async () => {
    const pageElement = await TeachersPage({
      searchParams: Promise.resolve({}),
    });
    const body = activeTeachersBodyElementOf(pageElement);
    await (body.type as (props: unknown) => Promise<unknown>)(body.props);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: teacherListOrderBy("alphabetical"),
    });
  });

  it("threads ?sort=date-added into the same orderBy teacherListOrderBy builds", async () => {
    const pageElement = await TeachersPage({
      searchParams: Promise.resolve({ sort: "date-added" }),
    });
    const body = activeTeachersBodyElementOf(pageElement);
    await (body.type as (props: unknown) => Promise<unknown>)(body.props);

    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: teacherListOrderBy("date-added"),
    });
  });

  it("threads ?sort=advisory-mode too, proving this is not a single hardcoded fallback", async () => {
    const pageElement = await TeachersPage({
      searchParams: Promise.resolve({ sort: "advisory-mode" }),
    });
    const body = activeTeachersBodyElementOf(pageElement);
    await (body.type as (props: unknown) => Promise<unknown>)(body.props);

    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: teacherListOrderBy("advisory-mode"),
    });
  });

  it("sorting changes order only: the where clause and paging are unaffected by ?sort", async () => {
    const withoutSort = await TeachersPage({ searchParams: Promise.resolve({}) });
    const withoutSortBody = activeTeachersBodyElementOf(withoutSort);
    await (withoutSortBody.type as (props: unknown) => Promise<unknown>)(
      withoutSortBody.props
    );
    const [{ where: whereA, skip: skipA, take: takeA }] = findMany.mock.calls[0] as [
      { where: unknown; skip: unknown; take: unknown },
    ];

    findMany.mockClear();

    const withSort = await TeachersPage({
      searchParams: Promise.resolve({ sort: "date-added" }),
    });
    const withSortBody = activeTeachersBodyElementOf(withSort);
    await (withSortBody.type as (props: unknown) => Promise<unknown>)(
      withSortBody.props
    );
    const [{ where: whereB, skip: skipB, take: takeB }] = findMany.mock.calls[0] as [
      { where: unknown; skip: unknown; take: unknown },
    ];

    expect(whereB).toEqual(whereA);
    expect(skipB).toEqual(skipA);
    expect(takeB).toEqual(takeA);
  });
});
