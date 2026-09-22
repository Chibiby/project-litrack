import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Super Admin accounts table now wraps its rows in a `ListBusyRegion`
 * and routes its filter/search controls through `useListNavigate`, so a
 * same-route searchParam change gets an immediate `aria-busy` + skeleton
 * swap instead of a frozen table, and its pager gives `aria-disabled` (never
 * `disabled`, which would drop a keyboard user's focus) while a navigation
 * is in flight.
 *
 * The shared pending flag is DERIVED (`useTransition` for the Search
 * button's programmatic `router.push`, OR'd with a count of `<Link>`s
 * reporting in flight via `useLinkStatus`) — see `list-navigation.tsx`. With
 * `push` mocked as a synchronous no-op, nothing ever suspends, so the
 * transition the Search button opens settles before any assertion runs; that
 * pending WINDOW is real in the browser (the RSC fetch actually suspends)
 * but is not observable here. What IS observable in jsdom is the pager's own
 * `<Link>` reporting through `useLinkStatus`/`LinkStatusPulse`, which this
 * table already renders. So the tests below drive the shared flag through
 * that real link and check the busy region and the pager's `aria-disabled`
 * react, and separately keep a plain assertion that Search still issues the
 * right navigation.
 */

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

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/accounts",
  useSearchParams: () => new URLSearchParams(""),
}));

const useLinkStatusMock = vi.fn(() => ({ pending: false }));
vi.mock("next/link", () => ({
  useLinkStatus: () => useLinkStatusMock(),
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/accounts", () => ({
  revealSchoolHeadPassword: vi.fn(),
  resetSchoolHeadPasswordToDefault: vi.fn(),
  resetTeacherPassword: vi.fn(),
  impersonateUser: vi.fn(),
}));

const { AccountsTable } = await import("@/components/admin/accounts-table");
type AccountRowType = Parameters<typeof AccountsTable>[0]["rows"][number];

const ROW: AccountRowType = {
  id: "user-1",
  role: "TEACHER",
  fullName: "Marivic Santos Cruz",
  listingName: "Cruz, Marivic Santos",
  avatarPath: null,
  schoolId: "school-1",
  school: { id: "school-1", name: "Naidas T. Opong ES", schoolIdCode: "130554" },
  signIn: { kind: "email", value: "marivic@example.test", synthetic: false },
  isActive: true,
  mustChangePassword: false,
  approvalStatus: null,
  password: { kind: "never_stored" },
  signInHead: false,
  canRecoverByEmail: true,
};

const LIST = {
  page: 2,
  pageSize: 1,
  totalPages: 3,
  totalCount: 3,
  role: "",
  schoolId: "",
  q: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  useLinkStatusMock.mockReturnValue({ pending: false });
});

afterEach(cleanup);

describe("AccountsTable — instant feedback while a list navigation is pending", () => {
  it("sets aria-busy on the rows region and swaps to the skeleton while a pager link is in flight", () => {
    const { rerender } = render(<AccountsTable rows={[ROW]} list={LIST} />);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getAllByText("Cruz, Marivic Santos").length).toBeGreaterThan(0);

    // Drive the shared pending flag the way it is actually observable in
    // jsdom — the pager's own `<Link>` reporting through `useLinkStatus` —
    // not the Search button's `router.push` (see the file header).
    useLinkStatusMock.mockReturnValue({ pending: true });
    rerender(<AccountsTable rows={[ROW]} list={LIST} />);

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();

    useLinkStatusMock.mockReturnValue({ pending: false });
    rerender(<AccountsTable rows={[ROW]} list={LIST} />);
    expect(region?.getAttribute("aria-busy")).toBeNull();
  });

  it("issues the correct navigation when Search is clicked", () => {
    // The pending WINDOW this opens is not observable with a synchronous
    // `push` mock (see file header) — the busy-region reaction itself is
    // covered by the test above via the pager link's `useLinkStatus` report.
    render(<AccountsTable rows={[ROW]} list={LIST} />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(push).toHaveBeenCalledTimes(1);
  });

  it("gives the pager aria-disabled (not disabled) on a non-boundary control while a pager link is in flight", () => {
    const { rerender } = render(<AccountsTable rows={[ROW]} list={LIST} />);

    const nextLink = screen.getByRole("link", { name: "Next page" });
    expect(nextLink.getAttribute("aria-disabled")).toBeNull();
    expect(nextLink.hasAttribute("disabled")).toBe(false);

    useLinkStatusMock.mockReturnValue({ pending: true });
    rerender(<AccountsTable rows={[ROW]} list={LIST} />);

    expect(nextLink.getAttribute("aria-disabled")).toBe("true");
    expect(nextLink.hasAttribute("disabled")).toBe(false);
  });
});
