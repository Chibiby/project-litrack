import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/reading-level", () => ({ bulkRecordMonthlyReadingLevel: vi.fn() }));

import { BandSelect } from "@/components/forms/aral-monthly-reading-level-grid-form";

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

afterEach(cleanup);

const OPTIONS = [
  { value: "A", code: "A", label: "Alpha level", tone: "" },
  { value: "B", code: "B", label: "Beta level", tone: "" },
];

describe("BandSelect accessibility", () => {
  it("names the trigger with the learner, band and current level", () => {
    render(
      <BandSelect options={OPTIONS} value="B" label="Ana — English reading level" onChange={vi.fn()} />
    );
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-label")).toBe("Ana — English reading level: Beta level");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("announces Not assessed when empty", () => {
    render(<BandSelect options={OPTIONS} value="" label="Ana" onChange={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Ana: Not assessed");
  });

  it("tracks the active option with aria-activedescendant on arrow keys", () => {
    render(<BandSelect options={OPTIONS} value="" label="Ana" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    const list = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(list.getAttribute("aria-activedescendant")).toBe(options[0].id);

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list.getAttribute("aria-activedescendant")).toBe(options[1].id);

    fireEvent.keyDown(list, { key: "End" });
    expect(list.getAttribute("aria-activedescendant")).toBe(options[2].id);
  });
});
