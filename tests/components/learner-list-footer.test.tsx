import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act, fireEvent } from "@testing-library/react";

// Radix Select needs pointer-event APIs jsdom does not implement.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const push = vi.fn();
const prefetch = vi.fn();
const useLinkStatusMock = vi.fn(() => ({ pending: false }));
let searchParamsString = "page=1";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, prefetch }),
  usePathname: () => "/teacher/learners",
  useSearchParams: () => ({ toString: () => searchParamsString }),
}));

vi.mock("next/link", () => ({
  useLinkStatus: () => useLinkStatusMock(),
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { LearnerListFooter } from "@/components/learners/learner-list-footer";
import { ListNavigationProvider } from "@/components/nav/list-navigation";

beforeEach(() => {
  push.mockClear();
  prefetch.mockClear();
  useLinkStatusMock.mockReset();
  useLinkStatusMock.mockReturnValue({ pending: false });
  searchParamsString = "page=4";
});
afterEach(() => {
  cleanup();
});

function renderFooter(overrides: Partial<Parameters<typeof LearnerListFooter>[0]> = {}) {
  return render(
    <ListNavigationProvider>
      <LearnerListFooter
        basePath="/teacher/learners"
        page={4}
        totalPages={10}
        totalCount={100}
        pageSize={10}
        searchParams={{ page: "4" }}
        {...overrides}
      />
    </ListNavigationProvider>
  );
}

describe("LearnerListFooter — numbered page links", () => {
  it("shows the pending affordance on a page link when useLinkStatus reports pending", () => {
    useLinkStatusMock.mockReturnValue({ pending: true });
    renderFooter();
    const pulses = document.querySelectorAll('[data-slot="link-status-pulse"]');
    expect(pulses.length).toBeGreaterThan(0);
    expect((pulses[0] as HTMLElement).style.opacity).toBe("1");
  });

  it("hides the pending affordance when useLinkStatus reports not pending", () => {
    useLinkStatusMock.mockReturnValue({ pending: false });
    renderFooter();
    const pulse = document.querySelector('[data-slot="link-status-pulse"]') as HTMLElement;
    expect(pulse).toBeTruthy();
    expect(pulse.style.opacity).toBe("0");
  });

  it("prefetches only the immediate neighbour pages on hover intent, not every numbered link", () => {
    vi.useFakeTimers();
    renderFooter();

    // Page window for page=4/totalPages=10 includes 1, gap, 3,4,5, gap, 10.
    const page3 = screen.getByLabelText("Page 3");
    const page5 = screen.getByLabelText("Page 5");
    const page1 = screen.getByLabelText("Page 1");
    const page10 = screen.getByLabelText("Page 10");

    fireEvent.mouseEnter(page3);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(prefetch).toHaveBeenCalledWith("/teacher/learners?page=3", { kind: "full" });

    prefetch.mockClear();
    fireEvent.mouseEnter(page5);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(prefetch).toHaveBeenCalledWith("/teacher/learners?page=5", { kind: "full" });

    prefetch.mockClear();
    fireEvent.mouseEnter(page1);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(prefetch).not.toHaveBeenCalled();

    prefetch.mockClear();
    fireEvent.mouseEnter(page10);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(prefetch).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("LearnerListFooter — rows per page", () => {
  it("navigates through useListNavigate (not a raw router.push call) and drops the page param", () => {
    renderFooter();
    const trigger = screen.getByLabelText(/rows per page/i);
    fireEvent.click(trigger);
    const option20 = screen.getByRole("option", { name: "20" });
    fireEvent.click(option20);
    expect(push).toHaveBeenCalledTimes(1);
    const target = push.mock.calls[0][0] as string;
    expect(target).toContain("perPage=20");
    expect(target).not.toContain("page=");
  });
});
