import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `AralTeacherTable` now renders `<ListNavigationProvider>` around an
 * `AralTeacherTablePanel` that reads `useListNavigate`/`ListBusyRegion`
 * strictly below it. Asserts the rendered `aria-busy` attribute and skeleton
 * swap, not a `router.push` call count.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/aral",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/learner", () => ({
  setLearnerAralTeacher: vi.fn(async () => ({ ok: true })),
}));

const { AralTeacherTable } = await import(
  "@/components/school-head/aral-teacher-table"
);
type AralLearnerRowType = Parameters<typeof AralTeacherTable>[0]["rows"][number];

const ROW: AralLearnerRowType = {
  id: "learner-1",
  fullName: "Ada Cruz",
  gradeLabel: "Grade 3",
  sectionName: "Sampaguita",
  adviserName: "Marivic Santos",
  aralTeacherId: null,
};

const LIST = {
  page: 1,
  totalPages: 1,
  totalCount: 1,
  q: "",
  basePath: "/school-head/aral",
  searchParams: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("AralTeacherTable — instant feedback while a list navigation is pending", () => {
  it("sets aria-busy on the rows region and swaps to the skeleton once search is applied", () => {
    render(<AralTeacherTable rows={[ROW]} teachers={[]} list={LIST} />);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText("Ada Cruz")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();
    expect(push).toHaveBeenCalledTimes(1);
  });
});
