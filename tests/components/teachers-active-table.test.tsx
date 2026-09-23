import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TEACHER_LIST_SORTS } from "@/lib/teachers/pagination";

/**
 * The School Head Active teachers table: it must display the surname-first
 * `listingName`, never the denormalized `fullName`, and — once a `list` with
 * `sort`/`sortOptions` is passed — it renders the "Sort by" control so the
 * display order and the visible order agree (see `06_AGENTS.md`-equivalent
 * consistency rule in the task: a table that shows surname-first but is
 * ordered by `fullName` looks unsorted).
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

const { TeachersActiveTable } = await import("@/components/teachers-active-table");
type ActiveTeacherRowType = Parameters<typeof TeachersActiveTable>[0]["rows"][number];

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("TeachersActiveTable — Name column", () => {
  it("renders listingName (surname-first), not fullName", () => {
    render(<TeachersActiveTable rows={[ROW]} />);

    // Scoped to the `lg`-and-up table: below `lg` the same row repeats as a
    // stacked list row, so an unscoped query would find both.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Cruz, Marivic Santos")).not.toBeNull();
    expect(screen.queryByText("Marivic Santos Cruz")).toBeNull();
  });
});

describe("TeachersActiveTable — Sort by", () => {
  const list = {
    page: 1,
    totalPages: 1,
    totalCount: 1,
    q: "",
    filter: "all" as const,
    basePath: "/school-head/teachers",
    searchParams: {},
    sort: "alphabetical" as const,
    sortOptions: TEACHER_LIST_SORTS.options,
  };

  it("renders the Sort by control when list carries sort + sortOptions", () => {
    render(<TeachersActiveTable rows={[ROW]} list={list} />);
    expect(screen.getByLabelText("Sort by")).not.toBeNull();
  });

  it("omits the Sort by control when list has no sort info (e.g. the inactive table's own list-less usage)", () => {
    render(<TeachersActiveTable rows={[ROW]} />);
    expect(screen.queryByLabelText("Sort by")).toBeNull();
  });
});
