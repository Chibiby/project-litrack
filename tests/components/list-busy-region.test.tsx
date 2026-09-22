import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

let pending = false;

vi.mock("@/components/nav/list-navigation", () => ({
  useListPending: () => pending,
}));

import { ListBusyRegion } from "@/components/loading/list-busy-region";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  pending = false;
  vi.useRealTimers();
});

function renderRegion() {
  return render(
    <ListBusyRegion
      label="learners"
      skeleton={<div data-testid="skeleton">skeleton</div>}
    >
      <table data-testid="rows">
        <tbody>
          <tr>
            <td>Ada</td>
          </tr>
        </tbody>
      </table>
    </ListBusyRegion>
  );
}

describe("ListBusyRegion", () => {
  it("sets aria-busy=true when pending and removes it when not", () => {
    pending = true;
    const { rerender } = renderRegion();
    const wrapper = document.querySelector('[data-slot="list-busy-region"]');
    expect(wrapper?.getAttribute("aria-busy")).toBe("true");

    pending = false;
    rerender(
      <ListBusyRegion label="learners" skeleton={<div data-testid="skeleton">skeleton</div>}>
        <table data-testid="rows">
          <tbody>
            <tr>
              <td>Ada</td>
            </tr>
          </tbody>
        </table>
      </ListBusyRegion>
    );
    expect(wrapper?.getAttribute("aria-busy")).toBeNull();
  });

  it("renders the skeleton and not the live rows while pending", () => {
    pending = true;
    renderRegion();
    expect(screen.getByTestId("skeleton")).toBeTruthy();
    expect(screen.queryByTestId("rows")).toBeNull();
  });

  it("renders the live rows and not the skeleton when settled", () => {
    pending = false;
    renderRegion();
    expect(screen.getByTestId("rows")).toBeTruthy();
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });

  it("has exactly one element with aria-live in the rendered region", () => {
    pending = true;
    const { container } = renderRegion();
    const liveEls = container.querySelectorAll("[aria-live]");
    expect(liveEls.length).toBe(1);
  });

  it("announces the loading state while pending, then the settled state once it resolves", () => {
    pending = true;
    const { rerender, container } = renderRegion();
    const live = container.querySelector("[aria-live]") as HTMLElement;
    expect(live.textContent).toMatch(/learners/i);
    expect(live.textContent).toMatch(/loading/i);

    pending = false;
    rerender(
      <ListBusyRegion label="learners" skeleton={<div data-testid="skeleton">skeleton</div>}>
        <table data-testid="rows">
          <tbody>
            <tr>
              <td>Ada</td>
            </tr>
          </tbody>
        </table>
      </ListBusyRegion>
    );
    expect(live.textContent).toMatch(/updated/i);
  });

  it("does not announce anything before a navigation has ever started", () => {
    pending = false;
    const { container } = renderRegion();
    const live = container.querySelector("[aria-live]") as HTMLElement;
    expect(live.textContent).toBe("");
  });
});
