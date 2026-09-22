import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * The School Head Teachers list threads `sort` through `page.tsx` into the
 * `list.searchParams` bag that `LearnerPagination`, the advisory filter, and
 * the search box all rebuild their hrefs from — none of them read
 * `useSearchParams()` themselves. Miss `sort` in that bag and every one of
 * those navigations silently resets the list to `alphabetical` (the
 * newest-N-teachers scenario in the bug report: page 2 becomes alphabetical
 * page 2, not the next 20 by date added).
 *
 * This test drives the real `page.tsx` (the same walk-the-element-tree
 * technique `teachers-page-sort-wiring.test.ts` uses for an async Server
 * Component) to get the exact `list` prop it hands to `TeachersActiveTable`,
 * then renders that table and exercises every navigation path a user has.
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
  usePathname: () => "/school-head/teachers",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const okResult = { ok: true as const };
vi.mock("@/lib/actions/school-head", () => ({
  clearRejectedTeacher: vi.fn(async () => okResult),
  removeTeacher: vi.fn(async () => okResult),
  setTeacherActive: vi.fn(async () => okResult),
}));
vi.mock("@/lib/actions/teacher", () => ({
  setTeacherAdvisorySection: vi.fn(async () => okResult),
  setTeacherAdvisorySetting: vi.fn(async () => okResult),
}));
vi.mock("@/lib/actions/avatar", () => ({
  removeUserAvatar: vi.fn(async () => ({ ok: true, dryRun: false })),
}));

// 45 so every count the page reads back (tab badge, filtered/search count)
// is large enough to produce more than one page — the pagination Next link
// only renders when `totalPages > 1`.
const findMany = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const gradeLevelFindMany = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const userCount = vi.fn(async (..._args: unknown[]) => 45);

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
const { TeachersActiveTable } = await import("@/components/teachers-active-table");
type ActiveTeacherRowType = Parameters<typeof TeachersActiveTable>[0]["rows"][number];
type TableListProp = NonNullable<Parameters<typeof TeachersActiveTable>[0]["list"]>;

const ROW: ActiveTeacherRowType = {
  id: "teacher-1",
  fullName: "Marivic Santos Cruz",
  listingName: "Cruz, Marivic Santos",
  email: "marivic@example.test",
  avatarPath: null,
  profileCompleted: true,
  approvedAt: "2026-06-01T00:00:00.000Z",
  learnerCount: 20,
  aralLearnerCount: 2,
  designation: "Teacher",
  advisoryMode: "DEFAULT",
  assignments: [{ sectionId: "sec-1", gradeName: "Grade 4", sectionName: "Sampaguita" }],
};

/** Walk `TeachersPage`'s returned tree to the `ActiveTeachersBody` element — same helper as `teachers-page-sort-wiring.test.ts`. */
function activeTeachersBodyElementOf(pageElement: ReactElement): ReactElement {
  const suspense = (pageElement.props as { children: ReactElement }).children;
  return (suspense.props as { children: ReactElement }).children;
}

function findTeachersActiveTableElement(node: ReactElement): ReactElement {
  const children = (node.props as { children?: unknown }).children;
  const candidates = Array.isArray(children) ? children : [children];
  for (const child of candidates) {
    if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      (child as ReactElement).type === TeachersActiveTable
    ) {
      return child as ReactElement;
    }
  }
  throw new Error("TeachersActiveTable element not found in ActiveTeachersBody output");
}

/**
 * The exact `list` prop `page.tsx` hands `TeachersActiveTable` for a given
 * query string — this is where the bug lived (the `searchParams` bag built
 * at `page.tsx:219-223`), so every scenario below renders whatever this
 * returns rather than hand-building a `list` object.
 */
async function listPropFor(
  searchParams: Record<string, string>
): Promise<TableListProp> {
  const pageElement = await TeachersPage({
    searchParams: Promise.resolve(searchParams),
  });
  const body = activeTeachersBodyElementOf(pageElement);
  const rendered = await (
    body.type as (props: unknown) => Promise<ReactElement>
  )(body.props);
  const tableElement = findTeachersActiveTableElement(rendered);
  return (tableElement.props as { list: TableListProp }).list;
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  gradeLevelFindMany.mockResolvedValue([]);
  userCount.mockResolvedValue(45);
});

afterEach(cleanup);

describe("Teachers list — sort survives URL round trips", () => {
  it("keeps the active sort in the pagination Next link", async () => {
    const list = await listPropFor({ sort: "date-added" });
    render(<TeachersActiveTable rows={[ROW]} list={list} />);

    const next = screen.getByRole("link", { name: /next/i });
    expect(next.getAttribute("href")).toContain("sort=date-added");
  });

  it("keeps the active sort when changing the advisory filter", async () => {
    const list = await listPropFor({ sort: "date-added" });
    render(<TeachersActiveTable rows={[ROW]} list={list} />);

    fireEvent.change(screen.getByLabelText("Filter teachers"), {
      target: { value: "teacher" },
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain("sort=date-added");
  });

  it("keeps the active sort when submitting the search box", async () => {
    const list = await listPropFor({ sort: "date-added" });
    render(<TeachersActiveTable rows={[ROW]} list={list} />);

    const search = screen.getByLabelText("Search active teachers");
    fireEvent.change(search, { target: { value: "cruz" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain("sort=date-added");
  });

  it("drops page when the sort itself changes", async () => {
    const list = await listPropFor({ sort: "date-added", page: "3" });
    render(<TeachersActiveTable rows={[ROW]} list={list} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Sort by" }));
    fireEvent.click(await screen.findByText("Advisory mode"));

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("sort=advisory-mode");
    expect(href).not.toContain("page=");
  });

  it("omits the default alphabetical sort from the URL", async () => {
    const list = await listPropFor({});
    expect(list.searchParams.sort).toBeUndefined();

    render(<TeachersActiveTable rows={[ROW]} list={list} />);
    const next = screen.getByRole("link", { name: /next/i });
    expect(next.getAttribute("href")).not.toContain("sort=");
  });
});
