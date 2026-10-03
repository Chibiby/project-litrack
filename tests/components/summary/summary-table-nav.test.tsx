import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryTableFrame, SummaryTableNavLink } from "@/components/summary/summary-table-nav";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  return render(
    <SummaryTableFrame>
      <SummaryTableNavLink href="/x?page.gender=2">Next</SummaryTableNavLink>
      <SummaryTableNavLink href="/x?sort.gender=total">Sort by Total</SummaryTableNavLink>
    </SummaryTableFrame>
  );
}

describe("SummaryTableNavLink", () => {
  it("pushes the href once without scrolling", () => {
    setup();
    fireEvent.click(screen.getByRole("link", { name: "Next" }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/x?page.gender=2", { scroll: false });
  });

  it("keeps a real href for open-in-new-tab", () => {
    setup();
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/x?page.gender=2");
  });

  it("ignores further clicks while the navigation is pending and marks the busy state", async () => {
    let settle!: () => void;
    push.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
    const { container } = setup();
    const next = screen.getByRole("link", { name: "Next" });

    await act(async () => {
      fireEvent.click(next);
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(next.getAttribute("aria-busy")).toBe("true");
    expect(container.firstElementChild!.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      fireEvent.click(next);
      fireEvent.click(screen.getByRole("link", { name: "Sort by Total" }));
    });
    expect(push).toHaveBeenCalledTimes(1);

    // Settle it: React entangles pending async transitions, so a dangling one would leak into the next test.
    await act(async () => settle());
  });

  it("accepts the next click once a navigation has settled", async () => {
    push.mockReturnValue(undefined);
    setup();
    const next = screen.getByRole("link", { name: "Next" });

    await act(async () => {
      fireEvent.click(next);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Sort by Total" }));
    });
    expect(push).toHaveBeenCalledTimes(2);
    expect(next.getAttribute("aria-busy")).toBeNull();
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
  ])("lets a %s-click fall through to the browser", (_name, init) => {
    setup();
    fireEvent.click(screen.getByRole("link", { name: "Next" }), init);
    expect(push).not.toHaveBeenCalled();
  });
});
