import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The header search's window-level Ctrl/⌘+K listener.
 *
 * It shipped as `event.key.toLowerCase()`, which threw
 * `Cannot read properties of undefined (reading 'toLowerCase')` for any
 * `keydown` dispatched without a `key` — a bare `new Event("keydown")` from a
 * browser extension or from dev tooling. TypeScript types `key` as `string`, so
 * only a runtime guard catches it and only a runtime test can prove the guard is
 * still there.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

import { HeaderSearch } from "@/components/shell/header-search";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("HeaderSearch — window keydown listener", () => {
  it("survives a keydown with no key at all", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);

    // Not fireEvent.keyDown: that always supplies a `key`. The bug needs a
    // plain Event, dispatched on window, exactly as an extension sends it.
    expect(() =>
      window.dispatchEvent(new Event("keydown"))
    ).not.toThrow();
  });

  it("still focuses the input on Ctrl+K", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    const input = screen.getByLabelText("Search learners...");
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(document.activeElement).toBe(input);
  });

  it("ignores k without a modifier", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    const input = screen.getByLabelText("Search learners...");

    fireEvent.keyDown(window, { key: "k" });

    expect(document.activeElement).not.toBe(input);
  });

  it("submits a trimmed query to the role's learner list", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);
    const input = screen.getByLabelText("Search learners...");

    fireEvent.change(input, { target: { value: "  Ana Santos  " } });
    fireEvent.submit(screen.getByRole("search"));

    expect(push).toHaveBeenCalledWith("/teacher/learners?q=Ana%20Santos");
  });

  it("does not navigate on an empty query", () => {
    render(<HeaderSearch searchHref="/teacher/learners" />);

    fireEvent.change(screen.getByLabelText("Search learners..."), {
      target: { value: "   " },
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(push).not.toHaveBeenCalled();
  });
});
