import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * `/school-head/audit`'s rows now sit in a `ListBusyRegion` inside a
 * `ListNavigationProvider` that is an ANCESTOR of both the region and the
 * pager (`LearnerPagination`'s `LinkStatusPulse`), never a sibling rendered
 * from the same async server component's return — the exact placement bug
 * `06_AGENTS.md`'s task brief warns about. This proves the rows region
 * actually flips `aria-busy` while a pagination link is pending, using the
 * rendered attribute rather than a `router.push` call count (a push-only
 * assertion would still pass if the provider were misplaced).
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const push = vi.fn();
const useLinkStatusMock = vi.fn(() => ({ pending: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/audit",
  useSearchParams: () => ({ toString: () => "" }),
}));

vi.mock("next/link", () => ({
  useLinkStatus: () => useLinkStatusMock(),
  default: ({
    children,
    href,
    prefetch: _p,
    ...rest
  }: React.ComponentProps<"a"> & { href: string; prefetch?: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const auditLogCount = vi.fn(async () => 60);
const auditLogFindMany = vi.fn(async () => [
  {
    id: "log-1",
    timestamp: new Date("2026-06-01T00:00:00.000Z"),
    action: "TEACHER_REMOVED",
    resource: "User",
    resourceId: "teacher-1",
  },
]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      count: (...args: unknown[]) => auditLogCount(...(args as [])),
      findMany: (...args: unknown[]) => auditLogFindMany(...(args as [])),
    },
    user: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock("@/lib/school-head/view", () => ({
  resolveSchoolHeadView: vi.fn(async () => ({
    user: { id: "head-1" },
    view: { schoolId: "school-1", schoolName: null, isSuperAdminView: false },
  })),
}));

const { default: SchoolAuditPage } = await import(
  "@/app/school-head/(app)/audit/page"
);

/** Walk the page's returned tree to the keyed `Suspense`, then its `SchoolAuditTable` child. */
function auditTableElementOf(pageElement: ReactElement): ReactElement {
  const suspense = (pageElement.props as { children: ReactElement }).children;
  return (suspense.props as { children: ReactElement }).children;
}

beforeEach(() => {
  vi.clearAllMocks();
  useLinkStatusMock.mockReturnValue({ pending: false });
  auditLogCount.mockResolvedValue(60);
  auditLogFindMany.mockResolvedValue([
    {
      id: "log-1",
      timestamp: new Date("2026-06-01T00:00:00.000Z"),
      action: "TEACHER_REMOVED",
      resource: "User",
      resourceId: "teacher-1",
    },
  ]);
});

afterEach(cleanup);

describe("School Head audit table — rows region busy state", () => {
  it("is not busy while nothing is pending", async () => {
    const pageElement = await SchoolAuditPage({
      searchParams: Promise.resolve({}),
    });
    const tableElement = auditTableElementOf(pageElement);
    const rendered = await (
      tableElement.type as (props: unknown) => Promise<ReactElement>
    )(tableElement.props);

    render(rendered);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region).toBeTruthy();
    expect(region?.getAttribute("aria-busy")).toBeNull();
    // The list view below `lg` repeats each row's action text beside the
    // table, so this must be scoped to the desktop table rather than the
    // whole document.
    const table = document.querySelector("table");
    expect(table).toBeTruthy();
    expect(within(table as HTMLElement).getByText("TEACHER_REMOVED")).not.toBeNull();
  });

  it("marks the rows region aria-busy while the pager's Next link is pending", async () => {
    const pageElement = await SchoolAuditPage({
      searchParams: Promise.resolve({}),
    });
    const tableElement = auditTableElementOf(pageElement);
    const rendered = await (
      tableElement.type as (props: unknown) => Promise<ReactElement>
    )(tableElement.props);

    useLinkStatusMock.mockReturnValue({ pending: true });
    render(rendered);

    const region = document.querySelector('[data-slot="list-busy-region"]');
    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="table-skeleton"]')).toBeTruthy();
  });
});
