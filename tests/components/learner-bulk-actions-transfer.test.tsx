import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LearnerBulkActions } from "@/components/learners/learner-bulk-actions";

/**
 * The roster's bulk menu: "Request transfer" is now a live item (it replaced
 * the inert "Transfer student"); "Export selected" is still declared but inert.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  // The menu defers its callbacks a frame; run them synchronously here.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(cleanup);

function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Bulk actions/ }), { key: "Enter" });
}

function setup(over: Partial<React.ComponentProps<typeof LearnerBulkActions>> = {}) {
  const props = {
    selectedCount: 2,
    onArchive: vi.fn(),
    onEnrollAral: vi.fn(),
    onRequestTransfer: vi.fn(),
    ...over,
  };
  render(<LearnerBulkActions {...props} />);
  openMenu();
  return props;
}

const isDisabled = (el: HTMLElement) =>
  el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");

describe("LearnerBulkActions — Request transfer", () => {
  it("enables Request transfer once learners are selected and calls the host", () => {
    const { onRequestTransfer } = setup();
    const item = screen.getByRole("menuitem", { name: /Request transfer/ });
    expect(isDisabled(item)).toBe(false);
    expect(item.textContent).not.toMatch(/Soon/);
    fireEvent.click(item);
    expect(onRequestTransfer).toHaveBeenCalledTimes(1);
  });

  it("disables Request transfer when nothing is selected", () => {
    const { onRequestTransfer } = setup({ selectedCount: 0 });
    const item = screen.getByRole("menuitem", { name: /Request transfer/ });
    expect(isDisabled(item)).toBe(true);
    fireEvent.click(item);
    expect(onRequestTransfer).not.toHaveBeenCalled();
  });

  it("disables Request transfer while an action is pending", () => {
    setup({ pending: true });
    // The trigger itself is disabled while pending, so the menu may not open;
    // either way the item must not be usable.
    const item = screen.queryByRole("menuitem", { name: /Request transfer/ });
    if (item) expect(isDisabled(item)).toBe(true);
  });

  it("hides the item when the host passes no handler", () => {
    setup({ onRequestTransfer: undefined });
    expect(screen.queryByRole("menuitem", { name: /Request transfer/ })).toBeNull();
  });

  it("no longer offers the inert Transfer student item", () => {
    setup();
    expect(screen.queryByRole("menuitem", { name: /Transfer student/ })).toBeNull();
  });
});

describe("LearnerBulkActions — Export selected", () => {
  it("is still inert and marked Soon, even with a selection", () => {
    setup();
    const item = screen.getByRole("menuitem", { name: /Export selected/ });
    expect(isDisabled(item)).toBe(true);
    expect(item.textContent).toMatch(/Soon/);
  });
});
