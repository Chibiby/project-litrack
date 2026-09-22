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

describe("ListNavigationProvider / useListNavigate / useListPending", () => {
  it("becomes pending as soon as navigate is called, before any params change", () => {
    render(
      <ListNavigationProvider>
        <PendingProbe />
        <NavigateButton href="/teacher/learners?page=2" />
      </ListNavigationProvider>
    );

    expect(screen.getByTestId("pending").textContent).toBe("false");
    act(() => {
      screen.getByText("go").click();
    });
    expect(screen.getByTestId("pending").textContent).toBe("true");
    expect(push).toHaveBeenCalledWith("/teacher/learners?page=2");
  });

  it("clears pending when the search-params string changes", () => {
    function Real() {
      const navigate = useListNavigate();
      const pending = useListPending();
      return (
        <div>
          <span data-testid="pending">{String(pending)}</span>
          <button type="button" onClick={() => navigate("/x?page=2")}>
            go
          </button>
        </div>
      );
    }

    const { rerender } = render(
      <ListNavigationProvider>
        <Real />
      </ListNavigationProvider>
    );

    act(() => {
      screen.getByText("go").click();
    });
    expect(screen.getByTestId("pending").textContent).toBe("true");

    // The URL commits: useSearchParams().toString() now returns a new value.
    searchParamsString = "page=2";
    rerender(
      <ListNavigationProvider>
        <Real />
      </ListNavigationProvider>
    );

    expect(screen.getByTestId("pending").textContent).toBe("false");
  });

  it("does not clear pending on a rerender where the params string is unchanged", () => {
    function Real() {
      const navigate = useListNavigate();
      const pending = useListPending();
      return (
        <div>
          <span data-testid="pending">{String(pending)}</span>
          <button type="button" onClick={() => navigate("/x?page=2")}>
            go
          </button>
        </div>
      );
    }

    const { rerender } = render(
      <ListNavigationProvider>
        <Real />
      </ListNavigationProvider>
    );

    act(() => {
      screen.getByText("go").click();
    });
    expect(screen.getByTestId("pending").textContent).toBe("true");

    // Rerender with the params string unchanged — pending must survive.
    rerender(
      <ListNavigationProvider>
        <Real />
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
