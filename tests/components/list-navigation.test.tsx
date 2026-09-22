import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";

const push = vi.fn();
let searchParamsString = "page=1";
const useLinkStatusMock = vi.fn(() => ({ pending: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ toString: () => searchParamsString }),
}));

vi.mock("next/link", () => ({
  useLinkStatus: () => useLinkStatusMock(),
}));

import {
  ListNavigationProvider,
  useListNavigate,
  useListPending,
  LinkStatusPulse,
} from "@/components/nav/list-navigation";

afterEach(() => {
  cleanup();
  push.mockClear();
  useLinkStatusMock.mockReset();
  useLinkStatusMock.mockReturnValue({ pending: false });
  searchParamsString = "page=1";
});

function PendingProbe() {
  const pending = useListPending();
  return <span data-testid="pending">{String(pending)}</span>;
}

function NavigateButton({ href }: { href: string }) {
  const navigate = useListNavigate();
  return (
    <button type="button" onClick={() => navigate(href)}>
      go
    </button>
  );
}

/**
 * Pending is DERIVED (a `useTransition` for programmatic pushes, OR'd with a
 * count of links currently reporting in flight), never latched.
 *
 * These tests previously asserted the opposite — a boolean set on click and
 * cleared only when `useSearchParams().toString()` changed. That contract had
 * a defect these tests could not see: any navigation that does not change the
 * URL (submitting the search box with unchanged text, re-applying a filter
 * already set) or that fails leaves the flag stuck on. Since `ListBusyRegion`
 * swaps rows for a skeleton immediately, a stuck flag means the rows vanish
 * until the user reloads. The tests below pin the derived contract instead.
 */
describe("ListNavigationProvider / useListNavigate / useListPending", () => {
  it("performs the navigation it is given", () => {
    render(
      <ListNavigationProvider>
        <PendingProbe />
        <NavigateButton href="/teacher/learners?page=2" />
      </ListNavigationProvider>
    );

    act(() => {
      screen.getByText("go").click();
    });

    expect(push).toHaveBeenCalledWith("/teacher/learners?page=2");
  });

  it("does not leave pending stuck on when the navigation never changes the URL", () => {
    // The regression guard for the latched-flag defect. Here `push` is a mock
    // that resolves immediately and `searchParamsString` never changes — the
    // shape of submitting a search with unchanged text. Under the old latched
    // contract this settled on `true` forever; pending must end up false.
    render(
      <ListNavigationProvider>
        <PendingProbe />
        <NavigateButton href="/x?page=1" />
      </ListNavigationProvider>
    );

    act(() => {
      screen.getByText("go").click();
    });

    expect(searchParamsString).toBe("page=1");
    expect(screen.getByTestId("pending").textContent).toBe("false");
  });

  it("is pending while a link reports in flight, and clears when it settles", () => {
    useLinkStatusMock.mockReturnValue({ pending: true });
    const { rerender } = render(
      <ListNavigationProvider>
        <PendingProbe />
        <LinkStatusPulse />
      </ListNavigationProvider>
    );
    expect(screen.getByTestId("pending").textContent).toBe("true");

    useLinkStatusMock.mockReturnValue({ pending: false });
    rerender(
      <ListNavigationProvider>
        <PendingProbe />
        <LinkStatusPulse />
      </ListNavigationProvider>
    );
    expect(screen.getByTestId("pending").textContent).toBe("false");
  });

  it("clears pending when an in-flight link unmounts", () => {
    // The keyed Suspense boundary unmounts the pager on every commit. If a
    // link's report were not withdrawn on unmount, the count would never
    // return to zero and the skeleton would stay up for good.
    useLinkStatusMock.mockReturnValue({ pending: true });
    const { rerender } = render(
      <ListNavigationProvider>
        <PendingProbe />
        <LinkStatusPulse />
      </ListNavigationProvider>
    );
    expect(screen.getByTestId("pending").textContent).toBe("true");

    rerender(
      <ListNavigationProvider>
        <PendingProbe />
      </ListNavigationProvider>
    );
    expect(screen.getByTestId("pending").textContent).toBe("false");
  });

  it("stays pending while a second link is still in flight", () => {
    // Counted rather than a boolean: with two links reporting, the first to
    // settle must not clear a sibling that is still navigating.
    useLinkStatusMock.mockReturnValue({ pending: true });
    const { rerender } = render(
      <ListNavigationProvider>
        <PendingProbe />
        <LinkStatusPulse />
        <LinkStatusPulse />
      </ListNavigationProvider>
    );
    expect(screen.getByTestId("pending").textContent).toBe("true");

    // One settles (unmounts); the other is still reporting.
    rerender(
      <ListNavigationProvider>
        <PendingProbe />
        <LinkStatusPulse />
      </ListNavigationProvider>
    );
    expect(screen.getByTestId("pending").textContent).toBe("true");
  });
});

describe("LinkStatusPulse", () => {
  function renderPulse() {
    return render(
      <ListNavigationProvider>
        <a href="/x">
          link
          <LinkStatusPulse />
        </a>
      </ListNavigationProvider>
    );
  }

  it("renders its pending affordance visible when useLinkStatus reports pending", () => {
    useLinkStatusMock.mockReturnValue({ pending: true });
    renderPulse();
    const pulse = document.querySelector('[data-slot="link-status-pulse"]') as HTMLElement;
    expect(pulse).toBeTruthy();
    expect(pulse.style.opacity).toBe("1");
  });

  it("keeps its pending affordance hidden when useLinkStatus reports not pending", () => {
    useLinkStatusMock.mockReturnValue({ pending: false });
    renderPulse();
    const pulse = document.querySelector('[data-slot="link-status-pulse"]') as HTMLElement;
    expect(pulse).toBeTruthy();
    expect(pulse.style.opacity).toBe("0");
  });

  it("feeds a pending link status up into the shared provider", () => {
    useLinkStatusMock.mockReturnValue({ pending: true });
    function Probe() {
      const pending = useListPending();
      return <span data-testid="pending">{String(pending)}</span>;
    }
    render(
      <ListNavigationProvider>
        <Probe />
        <a href="/x">
          link
          <LinkStatusPulse />
        </a>
      </ListNavigationProvider>
    );
    expect(screen.getByTestId("pending").textContent).toBe("true");
  });
});
