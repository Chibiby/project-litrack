import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Super Admin accounts table now wraps its rows in a `ListBusyRegion`
 * and routes its filter/search controls through `useListNavigate`, so a
 * same-route searchParam change gets an immediate `aria-busy` + skeleton
 * swap instead of a frozen table, and its pager gives `aria-disabled` (never
 * `disabled`, which would drop a keyboard user's focus) while a navigation
 * is in flight. `push` never resolving `useSearchParams()` to a new string
 * here is what keeps the navigation "in flight" for the assertions below —
 * mirrors the technique `list-navigation.test.tsx` uses.
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
});

afterEach(cleanup);

describe("AccountsTable — instant feedback while a list navigation is pending", () => {
  it("sets aria-busy on the rows region and swaps to the skeleton once a filter is applied", () => {
    render(<AccountsTable rows={[ROW]} list={LIST} />);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getAllByText("Cruz, Marivic Santos").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();
  });

  it("gives the pager aria-disabled (not disabled) on a non-boundary control while pending", () => {
    render(<AccountsTable rows={[ROW]} list={LIST} />);

    const nextLink = screen.getByRole("link", { name: "Next page" });
    expect(nextLink.getAttribute("aria-disabled")).toBeNull();
    expect(nextLink.hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(nextLink.getAttribute("aria-disabled")).toBe("true");
    expect(nextLink.hasAttribute("disabled")).toBe(false);
  });
});
