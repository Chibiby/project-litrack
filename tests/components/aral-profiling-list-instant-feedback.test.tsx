import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ListNavigationProvider,
  useListNavigate,
} from "@/components/nav/list-navigation";
import { ProfilingList, type ProfilingListRow } from "@/components/aral/profiling-list";

/**
 * `ProfilingList` wraps its rows in a `ListBusyRegion`. A same-route
 * searchParam navigation (status tab, search, section, page) must flip the
 * rows region's `aria-busy` and swap to the skeleton immediately, before the
 * RSC response for the new page ever arrives.
 *
 * The shared pending flag is DERIVED (`useTransition` OR'd with a count of
 * `<Link>`s reporting in flight via `useLinkStatus`), not latched — see
 * `list-navigation.tsx`. `NavigateButton` below drives a programmatic
 * `router.push` inside a transition; with `push` mocked as a synchronous
 * no-op nothing ever suspends, so that transition settles before any
 * assertion runs and its pending WINDOW is not observable here (it is real
 * in the browser, where the RSC fetch actually suspends). What IS observable
 * in jsdom is the other half of the same flag: a `<Link>` reporting through
 * `useLinkStatus`/`LinkStatusPulse`, which `ProfilingList`'s own pager
 * already renders once `totalPages > 1`.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, prefetch: vi.fn() }),
  usePathname: () => "/teacher/aral/profiling",
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

afterEach(() => {
  cleanup();
  useLinkStatusMock.mockReturnValue({ pending: false });
});

function row(overrides: Partial<ProfilingListRow> & { id: string }): ProfilingListRow {
  return {
    fullName: "Learner",
    gradeLabel: "Grade 5",
    sectionName: "Narra",
    done: false,
    lastUpdatedDisplay: "—",
    updateHref: `/teacher/aral/g5/learners/${overrides.id}/update`,
    ...overrides,
  };
}

// `totalPages: 2` so the list's own pager (Prev/Next `<Link>` +
// `LinkStatusPulse`) is actually on the page — that link is the observable
// path used to drive the shared pending flag below.
const baseProps = {
  totalCount: 1,
  page: 1,
  pageSize: 20,
  totalPages: 2,
  status: "all" as const,
  canEdit: true,
};

/** A control that lives OUTSIDE `ProfilingList`, standing in for `ProfilingToolbar`. */
function NavigateButton({ href }: { href: string }) {
  const navigate = useListNavigate();
  return (
    <button type="button" onClick={() => navigate(href)}>
      navigate
    </button>
  );
}

describe("ProfilingList — instant feedback while a list navigation is pending", () => {
  it("sets aria-busy on the rows region and swaps to the skeleton while a pager link is in flight", () => {
    const rows = [row({ id: "a", fullName: "Ana Cruz" })];
    const renderTree = () =>
      render(
        <ListNavigationProvider>
          <NavigateButton href="/teacher/aral/profiling?status=pending" />
          <ProfilingList {...baseProps} rows={rows} />
        </ListNavigationProvider>
      );
    const { rerender } = renderTree();

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getAllByText("Ana Cruz").length).toBeGreaterThan(0);

    // Drive the shared pending flag the way it is actually observable in
    // jsdom: the pager's own `<Link>` reporting through `useLinkStatus`, not
    // the toolbar button's `router.push` (a synchronous mock settles that
    // transition before this assertion runs — see the file header). A fresh
    // element tree on each `rerender` call, not a reused reference — React
    // bails out of visiting a subtree it has already committed the identical
    // element for, which would hide the mock flip from `useLinkStatus`.
    useLinkStatusMock.mockReturnValue({ pending: true });
    rerender(
      <ListNavigationProvider>
        <NavigateButton href="/teacher/aral/profiling?status=pending" />
        <ProfilingList {...baseProps} rows={rows} />
      </ListNavigationProvider>
    );

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();

    useLinkStatusMock.mockReturnValue({ pending: false });
    rerender(
      <ListNavigationProvider>
        <NavigateButton href="/teacher/aral/profiling?status=pending" />
        <ProfilingList {...baseProps} rows={rows} />
      </ListNavigationProvider>
    );
    expect(region?.getAttribute("aria-busy")).toBeNull();
  });

  it("issues the correct navigation when the toolbar navigates", () => {
    // The pending WINDOW this opens is not observable with a synchronous
    // `push` mock (see file header) — the busy-region reaction itself is
    // covered by the test above via the pager link's `useLinkStatus` report.
    const rows = [row({ id: "a", fullName: "Ana Cruz" })];
    render(
      <ListNavigationProvider>
        <NavigateButton href="/teacher/aral/profiling?status=pending" />
        <ProfilingList {...baseProps} rows={rows} />
      </ListNavigationProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));

    expect(push).toHaveBeenCalledWith("/teacher/aral/profiling?status=pending");
  });

  it("stays idle (no aria-busy) with no ListNavigationProvider above it", () => {
    const rows = [row({ id: "a", fullName: "Ana Cruz" })];
    render(<ProfilingList {...baseProps} rows={rows} />);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getAllByText("Ana Cruz").length).toBeGreaterThan(0);
  });
});

describe("ProfilingList — no gating on the ARAL Profile", () => {
  it("still renders a learner who has no saved ARAL profile", () => {
    const rows = [
      row({ id: "b", fullName: "Ben Reyes without a profile", done: false }),
    ];
    render(<ProfilingList {...baseProps} rows={rows} totalCount={1} />);

    expect(screen.getAllByText("Ben Reyes without a profile").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
  });
});
