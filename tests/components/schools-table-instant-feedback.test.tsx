import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Schools table now wraps its rows in a `ListBusyRegion` and routes
 * `pushList` through `useListNavigate`, so a same-route searchParam change
 * (search/filter/sort/page) gets an immediate `aria-busy` + skeleton swap
 * instead of a frozen table, and its Prev/Next pager gives `aria-disabled`
 * (never `disabled`, which would drop a keyboard user's focus) while a
 * navigation is in flight.
 *
 * `push` resolves to a `Promise` this file settles itself, rather than a
 * synchronous no-op: `useListNavigate()` runs `router.push` inside
 * `startTransition`, and React 19 keeps `isPending` true for as long as the
 * callback's returned promise is unsettled — a faithful stand-in for the
 * real RSC round trip, and what makes the shared pending flag's aria-busy
 * reaction observable here at all.
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

/** Resolver for whichever `push` call is currently in flight, if any. */
let resolvePush: (() => void) | null = null;
const push = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      resolvePush = resolve;
    })
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/schools",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/school", () => ({
  deleteSchool: vi.fn(),
  regenerateSchoolHeadCredential: vi.fn(),
}));

vi.mock("@/lib/actions/school-management", () => ({
  setSchoolActive: vi.fn(),
}));

const { SchoolsTable } = await import("@/components/schools-table");
type SchoolRowType = Parameters<typeof SchoolsTable>[0]["schools"][number];

const SCHOOL: SchoolRowType = {
  id: "school-1",
  name: "Naidas T. Opong ES",
  schoolIdCode: "130554",
  region: "NCR",
  division: "Manila",
  isActive: true,
  users: 5,
  learners: 40,
  isDemo: false,
};

const LIST = {
  page: 2,
  totalPages: 3,
  totalCount: 3,
  pageSize: 1,
  q: "",
  region: "",
  status: "" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  // Settle any still-pending navigation before the next test, so a left-open
  // transition can never bleed pending state (or an act() warning) across
  // tests.
  await act(async () => {
    resolvePush?.();
    resolvePush = null;
  });
  cleanup();
});

describe("SchoolsTable — instant feedback while a list navigation is pending", () => {
  it("sets aria-busy on the rows region and swaps to the skeleton once search is applied", async () => {
    render(<SchoolsTable schools={[SCHOOL]} list={LIST} />);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getAllByText("Naidas T. Opong ES").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();

    // Once the "navigation" settles, the flag clears — the regression guard
    // for the latched-flag defect this contract replaced (see
    // `list-navigation.tsx`).
    await act(async () => {
      resolvePush?.();
    });
    expect(region?.getAttribute("aria-busy")).toBeNull();
  });

  it("gives the Next pager control aria-disabled (not disabled) on a non-boundary page while pending", () => {
    render(<SchoolsTable schools={[SCHOOL]} list={LIST} />);

    const nextLink = screen.getByRole("link", { name: /Next/ });
    expect(nextLink.getAttribute("aria-disabled")).toBe("false");
    expect(nextLink.hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(nextLink.getAttribute("aria-disabled")).toBe("true");
    expect(nextLink.hasAttribute("disabled")).toBe(false);
  });

  it("keeps a genuinely unavailable boundary control (Previous on page 1) as disabled, not merely aria-disabled", () => {
    render(
      <SchoolsTable
        schools={[SCHOOL]}
        list={{ ...LIST, page: 1 }}
      />
    );

    const prevLink = screen.getByRole("link", { name: /Previous/ });
    expect(prevLink.getAttribute("aria-disabled")).toBe("true");
    expect(prevLink.hasAttribute("disabled")).toBe(true);
  });
});
