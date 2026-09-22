import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `TeachersActiveTable` now renders `<ListNavigationProvider>` around a
 * `TeachersActiveTablePanel` that reads `useListNavigate`/`ListBusyRegion`
 * strictly below it (the "silent-failure" placement bug this wave's brief
 * warns about — a provider rendered as a sibling of its own consumer never
 * throws, it just never raises `aria-busy`). This asserts the rendered
 * `aria-busy` attribute and the skeleton swap directly, not a `push` call
 * count, which would still pass even with the provider misplaced.
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
  // A stable, never-changing search string: the shared pending flag only
  // clears when useSearchParams().toString() changes, so this keeps the
  // navigation "in flight" for the assertions below.
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

const LIST = {
  page: 1,
  totalPages: 1,
  totalCount: 1,
  q: "",
  filter: "all" as const,
  basePath: "/school-head/teachers",
  searchParams: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("TeachersActiveTable — instant feedback while a list navigation is pending", () => {
  it("sets aria-busy on the rows region and swaps to the skeleton once search is applied", () => {
    render(<TeachersActiveTable rows={[ROW]} list={LIST} />);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText("Cruz, Marivic Santos")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("also goes busy when the advisory filter changes", () => {
    render(<TeachersActiveTable rows={[ROW]} list={LIST} />);
    const region = document.querySelector('[data-slot="list-busy-region"]');

    fireEvent.change(screen.getByLabelText("Filter teachers"), {
      target: { value: "teacher" },
    });

    expect(region?.getAttribute("aria-busy")).toBe("true");
  });
});
