import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";

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

import { LearnerPagination } from "@/components/learners/learner-pagination";
import { ListNavigationProvider } from "@/components/nav/list-navigation";

beforeEach(() => {
  push.mockClear();
  prefetch.mockClear();
  useLinkStatusMock.mockReset();
  useLinkStatusMock.mockReturnValue({ pending: false });
  searchParamsString = "page=1";
});
afterEach(() => {
  cleanup();
});

describe("LearnerPagination — link mode", () => {
  function renderLink() {
    return render(
      <ListNavigationProvider>
        <LearnerPagination
          basePath="/teacher/learners"
          page={2}
          totalPages={5}
          searchParams={{}}
        />
      </ListNavigationProvider>
    );
  }

  it("renders real anchors so middle-click / ctrl-click / copy-link keep working", () => {
    renderLink();
    const next = screen.getByText("Next").closest("a");
    const prev = screen.getByText("Prev").closest("a");
    expect(next).toBeTruthy();
    expect(next?.getAttribute("href")).toBe("/teacher/learners?page=3");
    expect(prev).toBeTruthy();
    expect(prev?.getAttribute("href")).toBe("/teacher/learners");
  });

  it("shows the pending affordance when useLinkStatus reports pending", () => {
    useLinkStatusMock.mockReturnValue({ pending: true });
    renderLink();
    const pulses = document.querySelectorAll('[data-slot="link-status-pulse"]');
    expect(pulses.length).toBeGreaterThan(0);
    (pulses[0] as HTMLElement).style.opacity;
    expect((pulses[0] as HTMLElement).style.opacity).toBe("1");
  });

  it("hides the pending affordance when useLinkStatus reports not pending", () => {
    useLinkStatusMock.mockReturnValue({ pending: false });
    renderLink();
    const pulse = document.querySelector('[data-slot="link-status-pulse"]') as HTMLElement;
    expect(pulse).toBeTruthy();
    expect(pulse.style.opacity).toBe("0");
  });

  it("prefetches only the adjacent page on hover intent, not both directions blindly", async () => {
    vi.useFakeTimers();
    renderLink();
    const next = screen.getByText("Next").closest("a") as HTMLElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.mouseEnter(next);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(prefetch).toHaveBeenCalledWith("/teacher/learners?page=3", { kind: "full" });
    vi.useRealTimers();
  });

  it("does not intent-prefetch the disabled Prev direction on page 1", async () => {
    vi.useFakeTimers();
    render(
      <ListNavigationProvider>
        <LearnerPagination
          basePath="/teacher/learners"
          page={1}
          totalPages={5}
          searchParams={{}}
        />
      </ListNavigationProvider>
    );
    const prev = screen.getByText("Prev").closest("a") as HTMLElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.mouseEnter(prev);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(prefetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("LearnerPagination — link mode with NO ListNavigationProvider ancestor", () => {
  // Regression guard: LearnerPagination is a shared component rendered by
  // several tables (admin accounts, schools, archive, school-detail, ARAL
  // profiling) that have not adopted ListNavigationProvider yet. It must
  // render and stay clickable even with no provider anywhere in the tree —
  // list-navigation.tsx's hooks degrade gracefully rather than throwing.
  it("renders working anchors with no ListNavigationProvider in the tree", () => {
    render(
      <LearnerPagination basePath="/teacher/learners" page={2} totalPages={5} searchParams={{}} />
    );
    const next = screen.getByText("Next").closest("a");
    const prev = screen.getByText("Prev").closest("a");
    expect(next?.getAttribute("href")).toBe("/teacher/learners?page=3");
    expect(prev?.getAttribute("href")).toBe("/teacher/learners");
  });

  it("still shows the pending affordance from useLinkStatus alone, with no provider", () => {
    useLinkStatusMock.mockReturnValue({ pending: true });
    render(
      <LearnerPagination basePath="/teacher/learners" page={2} totalPages={5} searchParams={{}} />
    );
    const pulse = document.querySelector('[data-slot="link-status-pulse"]') as HTMLElement;
    expect(pulse).toBeTruthy();
    expect(pulse.style.opacity).toBe("1");
  });
});

describe("LearnerPagination — client mode", () => {
  it("calls onPageChange and never touches the router", () => {
    const onPageChange = vi.fn();
    render(
      <LearnerPagination mode="client" page={2} totalPages={5} onPageChange={onPageChange} />
    );
    screen.getByText("Next").click();
    expect(onPageChange).toHaveBeenCalledWith(3);
    screen.getByText("Prev").click();
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(push).not.toHaveBeenCalled();
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("marks a pending control with aria-disabled, never the disabled attribute", () => {
    const onPageChange = vi.fn();
    render(
      <LearnerPagination
        mode="client"
        page={2}
        totalPages={5}
        onPageChange={onPageChange}
        pending
      />
    );
    const next = screen.getByText("Next").closest("button") as HTMLButtonElement;
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.disabled).toBe(false);
  });

  it("keeps the genuinely unavailable boundary control disabled, pending or not", () => {
    const onPageChange = vi.fn();
    render(
      <LearnerPagination mode="client" page={1} totalPages={5} onPageChange={onPageChange} />
    );
    const prev = screen.getByText("Prev").closest("button") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it("does not render aria-disabled at all when not pending", () => {
    const onPageChange = vi.fn();
    render(
      <LearnerPagination mode="client" page={2} totalPages={5} onPageChange={onPageChange} />
    );
    const next = screen.getByText("Next").closest("button") as HTMLButtonElement;
    expect(next.hasAttribute("aria-disabled")).toBe(false);
  });
});
