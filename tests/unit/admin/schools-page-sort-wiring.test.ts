import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { SCHOOLS_LIST_SORTS, schoolsListOrderBy } from "@/lib/cache/schools-list";

/**
 * Proves `/admin/schools` actually threads a non-empty `sortOptions` (and the
 * parsed `sort`) into the `SchoolsTable` it renders, and that the parsed sort
 * reaches the Prisma query `getSchoolsListPage` runs — not just that the
 * parser/registry exist. `SchoolsTable` itself already renders `SortSelect`
 * from these props (`src/components/schools-table.tsx`); what is untested
 * without this file is whether the page ever supplies them.
 *
 * `SchoolsTableBody` is an async Server Component and is not exported, so
 * rendering the page through `@testing-library/react` is not available here
 * (same constraint `teachers-page-sort-wiring.test.ts` documents). Instead,
 * the page's own returned element tree is walked to the `SchoolsTableBody`
 * element and its `SchoolsTable` child, exactly what React would do when
 * rendering this Suspense boundary.
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

const { default: SchoolsListPage } = await import("@/app/admin/schools/page");

/** Walk `SchoolsListPage`'s returned tree to the `SchoolsTableBody` element. */
function schoolsTableBodyElementOf(pageElement: ReactElement): ReactElement {
  const children = (pageElement.props as { children: ReactElement[] }).children;
  const suspense = children[children.length - 1];
  return (suspense.props as { children: ReactElement }).children;
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
});

describe("SchoolsListPage — sort wiring reaches SchoolsTable and the Prisma query", () => {
  it("supplies a non-empty sortOptions and the default sort to SchoolsTable", async () => {
    const pageElement = await SchoolsListPage({
      searchParams: Promise.resolve({}),
    });
    const body = schoolsTableBodyElementOf(pageElement);
    const tableElement = (await (body.type as (props: unknown) => Promise<ReactElement>)(
      body.props
    )) as ReactElement;

    // The body renders a fragment: [errorMessageOrNull, <Card><CardContent>
    // <SchoolsTable .../></CardContent></Card>].
    const fragmentChildren = (tableElement.props as { children: ReactElement[] }).children;
    const card = fragmentChildren[fragmentChildren.length - 1];
    const cardContent = (card.props as { children: ReactElement }).children;
    const table = (cardContent.props as { children: ReactElement }).children;

    const list = (table.props as { list: { sort?: string; sortOptions?: unknown[] } }).list;
    expect(list.sort).toBe("alphabetical");
    expect(list.sortOptions).toBeDefined();
    expect((list.sortOptions as unknown[]).length).toBeGreaterThan(0);
    expect(list.sortOptions).toEqual(SCHOOLS_LIST_SORTS.options);
  });

  it("threads ?sort=learners into the same orderBy schoolsListOrderBy builds", async () => {
    const pageElement = await SchoolsListPage({
      searchParams: Promise.resolve({ sort: "learners" }),
    });
    const body = schoolsTableBodyElementOf(pageElement);
    await (body.type as (props: unknown) => Promise<unknown>)(body.props);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: schoolsListOrderBy("learners"),
    });
  });
});
