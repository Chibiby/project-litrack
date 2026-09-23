import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * `/school-head/audit`'s below-`lg` stacked `<ul aria-label="Audit events">`
 * duplicates the desktop table's rows. This test fails if that list block is
 * removed — it renders the actual server component (as
 * `audit-instant-feedback.test.tsx` and `audit-page-list-key.test.ts` do) and
 * asserts both views carry the same fixture rows, in equal count.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/audit",
  useSearchParams: () => ({ toString: () => "" }),
}));

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
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

const FIXTURE_LOGS = [
  {
    id: "log-1",
    timestamp: new Date("2026-06-01T00:00:00.000Z"),
    action: "TEACHER_REMOVED",
    resource: "User",
    resourceId: "teacher-1",
  },
  {
    id: "log-2",
    timestamp: new Date("2026-06-02T00:00:00.000Z"),
    action: "TEACHER_APPROVED",
    resource: "User",
    resourceId: "teacher-2",
  },
];

const auditLogCount = vi.fn(async () => FIXTURE_LOGS.length);
const auditLogFindMany = vi.fn(async () => FIXTURE_LOGS);

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
  auditLogCount.mockResolvedValue(FIXTURE_LOGS.length);
  auditLogFindMany.mockResolvedValue(FIXTURE_LOGS);
});

afterEach(cleanup);

describe("School Head audit page — mobile list view", () => {
  it("renders the same row data as the desktop table, same row count", async () => {
    const pageElement = await SchoolAuditPage({
      searchParams: Promise.resolve({}),
    });
    const tableElement = auditTableElementOf(pageElement);
    const rendered = await (
      tableElement.type as (props: unknown) => Promise<ReactElement>
    )(tableElement.props);

    render(rendered);

    const table = document.querySelector("table") as HTMLElement;
    const list = screen.getByRole("list", { name: "Audit events" });
    expect(table).toBeTruthy();

    for (const log of FIXTURE_LOGS) {
      expect(within(table).getByText(log.action)).not.toBeNull();
      expect(within(list).getByText(log.action)).not.toBeNull();
      expect(within(list).getByText(log.resourceId as string)).not.toBeNull();
    }

    expect(within(table).getAllByRole("row")).toHaveLength(FIXTURE_LOGS.length + 1);
    expect(list.querySelectorAll("li")).toHaveLength(FIXTURE_LOGS.length);
  });
});
