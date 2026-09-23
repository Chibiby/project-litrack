import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `AralTeacherTable` now renders `<ListNavigationProvider>` around an
 * `AralTeacherTablePanel` that reads `useListNavigate`/`ListBusyRegion`
 * strictly below it. Asserts the rendered `aria-busy` attribute and skeleton
 * swap, not a `router.push` call count.
 *
 * The pending flag is DERIVED (`useTransition` OR'd with a count of links
 * reporting in flight via `useLinkStatus`), not latched — see
 * `list-navigation.tsx`. The Search button drives a programmatic
 * `router.push` inside a transition; with `push` mocked as a synchronous
 * no-op nothing ever suspends, so React settles that transition before any
 * assertion runs and the pending WINDOW it opens is not observable here (it
 * is real in the browser, where the RSC fetch actually suspends). What IS
 * observable in jsdom is the other half of the same derived flag: a `<Link>`
 * reporting through `useLinkStatus`/`LinkStatusPulse`, which the table's own
 * pager already renders once `list.totalPages > 1`. So this file drives the
 * shared pending state through that real, already-wired pager link and
 * checks the busy region reacts, and separately keeps a plain assertion that
 * the Search button still issues the right navigation.
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

const useLinkStatusMock = vi.fn(() => ({ pending: false }));
vi.mock("next/link", () => ({
  useLinkStatus: () => useLinkStatusMock(),
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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

// `totalPages: 2` so the table's own pager (Prev/Next `<Link>` +
// `LinkStatusPulse`) is actually on the page — that link is the observable
// path used to drive the shared pending flag below.
const LIST = {
  page: 1,
  totalPages: 2,
  totalCount: 2,
  q: "",
  basePath: "/school-head/aral",
  searchParams: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useLinkStatusMock.mockReturnValue({ pending: false });
});

afterEach(cleanup);

describe("AralTeacherTable — instant feedback while a list navigation is pending", () => {
  it("sets aria-busy on the rows region and swaps to the skeleton while a pager link is in flight", () => {
    useLinkStatusMock.mockReturnValue({ pending: false });
    const { rerender } = render(<AralTeacherTable rows={[ROW]} teachers={[]} list={LIST} />);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    // Scoped to the `lg`-and-up table: below `lg` the same row repeats as a
    // stacked list row, so an unscoped query would find both.
    expect(within(screen.getByRole("table")).getByText("Ada Cruz")).not.toBeNull();

    // Drive the shared pending flag the way it is actually observable in
    // jsdom: the pager's own `<Link>` reporting through `useLinkStatus`, not
    // the Search button's `router.push` (a synchronous mock settles that
    // transition before this assertion runs — see the file header).
    useLinkStatusMock.mockReturnValue({ pending: true });
    rerender(<AralTeacherTable rows={[ROW]} teachers={[]} list={LIST} />);

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();

    useLinkStatusMock.mockReturnValue({ pending: false });
    rerender(<AralTeacherTable rows={[ROW]} teachers={[]} list={LIST} />);
    expect(region?.getAttribute("aria-busy")).toBeNull();
  });

  it("issues the correct navigation when Search is clicked", () => {
    // The pending WINDOW this opens is not observable with a synchronous
    // `push` mock (see file header) — the busy-region reaction itself is
    // covered by the test above via the pager link's `useLinkStatus` report.
    render(<AralTeacherTable rows={[ROW]} teachers={[]} list={LIST} />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toBe("/school-head/aral");
  });
});
