import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfilingList, type ProfilingListRow } from "@/components/aral/profiling-list";

// LearnerPagination (rendered by ProfilingList when totalPages > 1) uses
// PrefetchLink, which calls useRouter()/usePathname() eagerly — real
// next/navigation throws outside an app router, so it needs a mock here the
// same as every other list-navigation consumer test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/teacher/aral/profiling",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

function row(overrides: Partial<ProfilingListRow> & { id: string }): ProfilingListRow {
  return {
    fullName: "Learner",
    gradeLabel: "Grade 5",
    sectionName: "Narra",
    done: false,
    lastUpdatedDisplay: "—",
    updateHref: `/teacher/aral/g5/learners/${overrides.id}/update`,
    ...overrides,
  };
}

const baseProps = {
  totalCount: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  status: "all" as const,
  canEdit: true,
};

describe("ProfilingList", () => {
  it("numbers rows absolutely across pages, in both the table and the phone list", () => {
    const rows = [row({ id: "a", fullName: "Ana" }), row({ id: "b", fullName: "Ben" })];
    render(
      <ProfilingList
        {...baseProps}
        rows={rows}
        totalCount={41}
        page={2}
        pageSize={20}
        totalPages={3}
      />
    );

    const table = within(screen.getByRole("table"));
    expect(table.getByText("21")).toBeTruthy();
    expect(table.getByText("22")).toBeTruthy();

    const list = screen.getByRole("list", { name: "ARAL learners" });
    expect(within(list).getByText("21.")).toBeTruthy();
    expect(within(list).getByText("22.")).toBeTruthy();
  });

  it("shows Completed and an Update profile link for a saved profile", () => {
    const rows = [
      row({
        id: "a",
        fullName: "Ana Cruz",
        done: true,
        lastUpdatedDisplay: "Jan 15, 2026",
        updateHref: "/teacher/aral/g5/learners/a/update",
      }),
    ];
    render(<ProfilingList {...baseProps} rows={rows} totalCount={1} />);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Completed")).toBeTruthy();
    const tableLink = table.getByRole("link", { name: "Update profile" }) as HTMLAnchorElement;
    expect(tableLink.getAttribute("href")).toBe("/teacher/aral/g5/learners/a/update");

    const list = screen.getByRole("list", { name: "ARAL learners" });
    const listWithin = within(list);
    expect(listWithin.getByText("Completed")).toBeTruthy();
    const listLink = listWithin.getByRole("link", { name: "Update profile" }) as HTMLAnchorElement;
    expect(listLink.getAttribute("href")).toBe("/teacher/aral/g5/learners/a/update");
  });

  it("shows Pending and a Complete profile link for a learner with no saved profile", () => {
    const rows = [
      row({
        id: "b",
        fullName: "Ben Reyes",
        done: false,
        updateHref: "/teacher/aral/g5/learners/b/update",
      }),
    ];
    render(<ProfilingList {...baseProps} rows={rows} totalCount={1} />);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Pending")).toBeTruthy();
    const tableLink = table.getByRole("link", { name: "Complete profile" }) as HTMLAnchorElement;
    expect(tableLink.getAttribute("href")).toBe("/teacher/aral/g5/learners/b/update");

    const list = screen.getByRole("list", { name: "ARAL learners" });
    const listWithin = within(list);
    expect(listWithin.getByText("Pending")).toBeTruthy();
    const listLink = listWithin.getByRole("link", { name: "Complete profile" }) as HTMLAnchorElement;
    expect(listLink.getAttribute("href")).toBe("/teacher/aral/g5/learners/b/update");
  });

  it("renders no action column and no profile links when canEdit is false", () => {
    const rows = [row({ id: "a", fullName: "Ana", done: true })];
    render(<ProfilingList {...baseProps} rows={rows} totalCount={1} canEdit={false} />);

    expect(screen.queryByRole("columnheader", { name: "Action" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Update profile" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Complete profile" })).toBeNull();
  });

  it("shows an em dash in the table for a section-less learner", () => {
    const rows = [row({ id: "a", fullName: "Ana", sectionName: null })];
    render(<ProfilingList {...baseProps} rows={rows} totalCount={1} />);

    const table = within(screen.getByRole("table"));
    const dataRow = table.getAllByRole("row")[1];
    const cells = within(dataRow).getAllByRole("cell");
    // Columns: #, Learner, Grade, Section, Profile Status, Last Updated, Action.
    expect(cells[3].textContent).toBe("—");
  });

  it("renders the EmptyState and no table when totalCount is 0", () => {
    render(<ProfilingList {...baseProps} rows={[]} totalCount={0} />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No ARAL learners")).toBeTruthy();
  });
});
