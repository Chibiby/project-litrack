/**
 * Guards the book-shelf loader and the slow-load threshold that reveals it.
 *
 * Two separate contracts live here, and they fail in opposite directions:
 *
 *  - `BookLoader` announces the wait exactly once, or not at all when it is
 *    layered over a skeleton that already announces. Two live regions over one
 *    wait is a screen reader saying "Loading page" twice.
 *  - `RouteLoadingOverlay` shows the shelf only after the delay. A regression to
 *    an immediate render is invisible to a human on a fast connection and turns
 *    every prefetched navigation into a flash — which is the exact defect the
 *    threshold exists to prevent, so it needs a test rather than an eyeball.
 *
 * The delay assertions bracket the boundary on both sides deliberately. Checking
 * only that the book appears after 500ms passes just as happily if the component
 * renders it at 0ms, and that mistake is the whole failure mode.
 *
 * On CSS module class names below: Vitest is configured with `css` off, so a CSS
 * Modules import returns a proxy whose values are the keys themselves. That is
 * why the small variant asserts the literal `"shelfSm"` and not a build hash.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { BookLoader, ContentRouteLoading } from "@/components/loading";
import {
  RouteLoadingOverlay,
  SLOW_LOAD_DELAY_MS,
} from "@/components/loading/route-loading-overlay";
import RootLoading from "@/app/loading";
import TeacherLearnersLoading from "@/app/teacher/(app)/learners/loading";
import { clearPendingPostLoginSplash } from "@/lib/post-login-flag";

const BOOK = '[data-slot="book-loader"]';
const SHELF = '[data-slot="book-loader-shelf"]';
const OVERLAY = '[data-slot="route-loading-overlay"]';

afterEach(cleanup);
beforeEach(() => {
  // The bridge covers every fresh document; release it so children render.
  clearPendingPostLoginSplash();
});

describe("BookLoader", () => {
  it("draws the whole shelf", () => {
    const { container } = render(<BookLoader />);

    const shelf = container.querySelector(SHELF);
    expect(shelf).not.toBeNull();
    // Five, because the CSS module assigns a fill colour and a stagger delay per
    // `nth-child` up to five. A sixth book would render grey and unanimated.
    expect(shelf!.children).toHaveLength(5);
  });

  it("announces the wait once by default", () => {
    const { container } = render(<BookLoader />);
    const root = container.querySelector(BOOK)!;

    expect(root.getAttribute("role")).toBe("status");
    expect(root.getAttribute("aria-live")).toBe("polite");
    expect(root.getAttribute("aria-hidden")).toBeNull();
    expect(root.querySelector(".sr-only")?.textContent).toBe("Loading page");
    // The shelf is decoration inside the announced region, not a second one.
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("takes a caller's label", () => {
    const { container } = render(<BookLoader label="Loading the grade sheet" />);

    expect(container.querySelector(".sr-only")?.textContent).toBe(
      "Loading the grade sheet"
    );
  });

  it("says nothing at all when decorative", () => {
    const { container } = render(<BookLoader decorative />);
    const root = container.querySelector(BOOK)!;

    // Every part of this matters for the overlay case: the skeleton underneath
    // already owns the slot's live region, so this instance must be fully silent
    // rather than merely quiet.
    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("aria-live")).toBeNull();
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector(".sr-only")).toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it("scales down for a content slot", () => {
    const md = render(<BookLoader />).container.querySelector(SHELF)!;
    const sm = render(<BookLoader size="sm" />).container.querySelector(SHELF)!;

    expect(md.className).not.toContain("shelfSm");
    expect(sm.className).toContain("shelfSm");
  });
});

describe("RouteLoadingOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the skeleton immediately and no book", () => {
    const { container } = render(
      <RouteLoadingOverlay>
        <p data-slot="test-skeleton">skeleton</p>
      </RouteLoadingOverlay>
    );

    expect(container.querySelector('[data-slot="test-skeleton"]')).not.toBeNull();
    expect(container.querySelector(BOOK)).toBeNull();
  });

  it("still shows no book one tick before the threshold", () => {
    const { container } = render(
      <RouteLoadingOverlay>
        <p>skeleton</p>
      </RouteLoadingOverlay>
    );

    act(() => {
      vi.advanceTimersByTime(SLOW_LOAD_DELAY_MS - 1);
    });

    // The half of the contract that a "renders at 0ms" regression breaks.
    expect(container.querySelector(BOOK)).toBeNull();
  });

  it("fades the book in once the threshold passes", () => {
    const { container } = render(
      <RouteLoadingOverlay>
        <p data-slot="test-skeleton">skeleton</p>
      </RouteLoadingOverlay>
    );

    act(() => {
      vi.advanceTimersByTime(SLOW_LOAD_DELAY_MS);
    });

    expect(container.querySelector(BOOK)).not.toBeNull();
    // Layered, not swapped: the skeleton is what holds the layout steady when
    // the real page finally arrives, so replacing it would reintroduce the shift.
    expect(container.querySelector('[data-slot="test-skeleton"]')).not.toBeNull();
  });

  it("adds no second live region when it appears", () => {
    const { container } = render(
      <RouteLoadingOverlay>
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading learners</span>
        </div>
      </RouteLoadingOverlay>
    );

    act(() => {
      vi.advanceTimersByTime(SLOW_LOAD_DELAY_MS);
    });

    expect(container.querySelector(BOOK)).not.toBeNull();
    // Still one — the skeleton's. The overlay renders its shelf decoratively
    // precisely so a slow load is not announced a second time.
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("honours a caller's delay", () => {
    const { container } = render(
      <RouteLoadingOverlay delayMs={2000}>
        <p>skeleton</p>
      </RouteLoadingOverlay>
    );

    act(() => {
      vi.advanceTimersByTime(SLOW_LOAD_DELAY_MS);
    });
    expect(container.querySelector(BOOK)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000 - SLOW_LOAD_DELAY_MS);
    });
    expect(container.querySelector(BOOK)).not.toBeNull();
  });

  it("drops its timer when the navigation lands first", () => {
    const { unmount } = render(
      <RouteLoadingOverlay>
        <p>skeleton</p>
      </RouteLoadingOverlay>
    );

    // The common case: the page arrives, this boundary unmounts, and the pending
    // timer must not fire into an unmounted tree.
    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(SLOW_LOAD_DELAY_MS * 4);
      });
    }).not.toThrow();
    expect(document.querySelector(BOOK)).toBeNull();
  });
});

describe("the boundaries that draw the shelf", () => {
  it("ContentRouteLoading is the wait, and announces it once", () => {
    const { container } = render(<ContentRouteLoading />);
    const root = container.firstElementChild!;

    expect(container.querySelector(BOOK)).not.toBeNull();
    expect(root.getAttribute("aria-busy")).toBe("true");
    // `aria-busy` on the container, the announcement on BookLoader. The container
    // deliberately carries no `aria-live` of its own: it used to, alongside its
    // own `sr-only` span, and keeping both would announce every light-route
    // navigation twice.
    expect(root.getAttribute("aria-live")).toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("the root boundary draws the shelf and nothing route-shaped", () => {
    const { container } = render(<RootLoading />);
    const root = container.firstElementChild!;

    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(BOOK)).not.toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    // The shelf is the *only* thing here, and that is the contract rather than a
    // detail. This boundary sits above every layout, so it cannot know which role
    // or route is arriving — it used to draw a teacher dashboard, which appeared
    // chrome-less on the first paint of routes that look nothing like it. Adding
    // any second child back, metric cards or otherwise, is the regression.
    expect(root.children).toHaveLength(1);
    expect((root.firstElementChild as HTMLElement).dataset.slot).toBe(
      "book-loader"
    );
  });

  it("a wrapped route boundary shows its skeleton first, then the shelf", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TeacherLearnersLoading />);

      // End to end through a real boundary, not the overlay in isolation.
      expect(container.querySelector(OVERLAY)).not.toBeNull();
      expect(
        container.querySelector('[data-slot="roster-header-skeleton"]')
      ).not.toBeNull();
      expect(container.querySelector(BOOK)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(SLOW_LOAD_DELAY_MS);
      });

      expect(container.querySelector(BOOK)).not.toBeNull();
      expect(
        container.querySelector('[data-slot="roster-header-skeleton"]')
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
