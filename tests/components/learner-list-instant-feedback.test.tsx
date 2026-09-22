import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerListRow } from "@/components/learners/learner-list-client";

/**
 * Proves the roster's instant-feedback adoption: a keystroke in search shows
 * the skeleton before the 500ms debounce even starts a navigation, and a real
 * list navigation (search submit, sort, pager, facet) marks the rows region
 * `aria-busy` via the shared `ListNavigationProvider` — not a raw
 * `router.push` that this panel used to call directly.
 *
 * Deleting either behaviour should fail one of these tests:
 *  - remove the `setSearchBusy(true)` call on keystroke → the "raises busy
 *    immediately" test fails because the skeleton never appears before the
 *    debounce fires.
 *  - shorten/lengthen `SEARCH_DEBOUNCE_MS` or fire the navigation early →
 *    the "still debounces at 500ms" test fails.
 *  - revert `onNavigate`/`pushSearch` to `router.push` instead of
 *    `useListNavigate()` → the aria-busy test fails, because a raw
 *    `router.push` never touches the shared pending flag `ListBusyRegion`
 *    reads.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
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

const getLearnerProfile = vi.fn().mockResolvedValue({ ok: false, error: "Not found" });
vi.mock("@/lib/actions/learner-profile", () => ({
  getLearnerProfile: (...args: unknown[]) => getLearnerProfile(...(args as [])),
}));
vi.mock("@/lib/actions/learner", () => ({
  deleteLearners: vi.fn(async () => ({ ok: true })),
  archiveLearners: vi.fn(async () => ({ ok: true, data: { archived: 0 } })),
  restoreLearner: vi.fn(async () => ({ ok: true })),
  toggleAralLearner: vi.fn(async () => ({ ok: true })),
  enrollRosterLearnersToAral: vi.fn(async () => ({
    ok: true,
    data: { enrolled: 0, redesignated: 0 },
  })),
}));
vi.mock("@/lib/actions/aral-tutors", () => ({
  listAralTutorOptions: vi.fn().mockResolvedValue({ ok: true, data: { tutors: [], selfId: "self" } }),
}));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "toast-1") },
}));

const { LearnerListClient } = await import(
  "@/components/learners/learner-list-client"
);

const ROWS: LearnerListRow[] = [
  {
    id: "learner-1",
    fullName: "Ana Santos",
    listingName: "Santos, Ana",
    age: 10,
    gender: "FEMALE",
    isAralLearner: false,
    archivedAt: null,
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    section: { id: "sec-1", name: "Sampaguita" },
    gradeLevelId: "grade-g3",
    gradeType: "G3",
  },
];

function renderRoster() {
  return render(
    <LearnerListClient
      gender="all"
      aralStatus="all"
      sections={[{ id: "sec-1", name: "Sampaguita" }]}
      isSuperAdmin={false}
      learners={ROWS}
      page={1}
      pageSize={10}
      totalCount={ROWS.length}
      q=""
      archivedView={false}
    />
  );
}

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LearnerListClient — instant feedback", () => {
  it("marks the rows region aria-busy once a real list navigation is pending", () => {
    renderRoster();
    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();

    const input = screen.getByRole("textbox", { name: "Search learners by name" });
    fireEvent.change(input, { target: { value: "Ben" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(push).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-slot="list-busy-region"]')?.getAttribute("aria-busy")).toBe(
      "true"
    );
  });

  it("raises the busy skeleton on keystroke, before the 500ms debounce fires", () => {
    vi.useFakeTimers();
    renderRoster();
    expect(screen.getAllByText("Santos, Ana").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeNull();

    const input = screen.getByRole("textbox", { name: "Search learners by name" });
    fireEvent.change(input, { target: { value: "Ben" } });

    // Skeleton appears immediately — no navigation has started yet.
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();
    expect(screen.queryByText("Santos, Ana")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("still waits the full 500ms before issuing the query", () => {
    vi.useFakeTimers();
    renderRoster();
    const input = screen.getByRole("textbox", { name: "Search learners by name" });
    fireEvent.change(input, { target: { value: "Ben" } });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toBe("/teacher/learners?q=Ben");
  });
});
