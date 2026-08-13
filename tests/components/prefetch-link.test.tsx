import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act, fireEvent } from "@testing-library/react";

const prefetch = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { PrefetchLink, resetIntentBudget } from "@/components/nav/prefetch-link";
import { INTENT_DELAY_MS } from "@/lib/nav/prefetch-intent";

beforeEach(() => {
  prefetch.mockClear();
  resetIntentBudget();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("PrefetchLink", () => {
  it("prefetches after the intent delay on hover", () => {
    render(<PrefetchLink href="/teacher/reports">Reports</PrefetchLink>);
    fireEvent.mouseEnter(screen.getByText("Reports"));
    expect(prefetch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS); });
    expect(prefetch).toHaveBeenCalledWith("/teacher/reports", { kind: "full" });
  });

  it("does not prefetch on a pass-over hover", () => {
    render(<PrefetchLink href="/teacher/reports">Reports</PrefetchLink>);
    const el = screen.getByText("Reports");
    fireEvent.mouseEnter(el);
    act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS - 20); });
    fireEvent.mouseLeave(el);
    act(() => { vi.advanceTimersByTime(200); });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("prefetches on keyboard focus", () => {
    render(<PrefetchLink href="/teacher/learners">Learners</PrefetchLink>);
    fireEvent.focus(screen.getByText("Learners"));
    act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS); });
    expect(prefetch).toHaveBeenCalledWith("/teacher/learners", { kind: "full" });
  });

  it("prefetches immediately on touchstart (no hover on mobile)", () => {
    render(<PrefetchLink href="/teacher/aral">ARAL</PrefetchLink>);
    fireEvent.touchStart(screen.getByText("ARAL"));
    expect(prefetch).toHaveBeenCalledWith("/teacher/aral", { kind: "full" });
  });

  it("prefetches an href at most once", () => {
    render(<PrefetchLink href="/teacher/reports">Reports</PrefetchLink>);
    const el = screen.getByText("Reports");
    for (let i = 0; i < 3; i++) {
      fireEvent.mouseEnter(el);
      act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS); });
      fireEvent.mouseLeave(el);
    }
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("skips intent prefetch when intent is false", () => {
    render(<PrefetchLink href="/teacher/reports" intent={false}>Reports</PrefetchLink>);
    fireEvent.mouseEnter(screen.getByText("Reports"));
    act(() => { vi.advanceTimersByTime(INTENT_DELAY_MS); });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("still renders a working anchor", () => {
    render(<PrefetchLink href="/teacher" className="nav">Home</PrefetchLink>);
    const a = screen.getByText("Home");
    expect(a.getAttribute("href")).toBe("/teacher");
    expect(a.className).toContain("nav");
  });
});
