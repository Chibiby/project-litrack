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
 * RSC response for the new page ever arrives — proven here by never letting
 * `useSearchParams()` resolve to a new string, exactly like
 * `schools-table-instant-feedback.test.tsx`.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, prefetch: vi.fn() }),
  usePathname: () => "/teacher/aral/profiling",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

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

const baseProps = {
  totalCount: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
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
  it("sets aria-busy on the rows region and swaps to the skeleton once a navigation starts", () => {
    const rows = [row({ id: "a", fullName: "Ana Cruz" })];
    render(
      <ListNavigationProvider>
        <NavigateButton href="/teacher/aral/profiling?status=pending" />
        <ProfilingList {...baseProps} rows={rows} />
      </ListNavigationProvider>
    );

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getAllByText("Ana Cruz").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();
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
