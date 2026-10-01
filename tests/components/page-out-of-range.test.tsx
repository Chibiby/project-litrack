import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A page number past the last page (an old bookmark, a list that shrank) has no
 * rows but the list is NOT empty. The table must not say "No teachers yet" or
 * "No teachers match"; it says the page is past the end, offers "Go to page 1"
 * (keeping the filters and sort), and still shows the pager so the reader can
 * step back to the real last page.
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

let currentQuery = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/management/teachers",
  useSearchParams: () => new URLSearchParams(currentQuery),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/accounts", () => ({
  revealSchoolHeadPassword: vi.fn(),
  resetSchoolHeadPasswordToDefault: vi.fn(),
  resetTeacherPassword: vi.fn(),
  resetDistrictAdminPassword: vi.fn(),
  impersonateUser: vi.fn(),
}));

const { AccountsTable } = await import("@/components/admin/accounts-table");
const { LearnersDirectory } = await import("@/components/admin/management/learners-directory");

const TEACHERS_PATH = "/admin/management/teachers";
const LEARNERS_PATH = "/admin/management/learners";

beforeEach(() => {
  currentQuery = "";
});
afterEach(cleanup);

function accounts(list: Partial<{ page: number; totalPages: number; totalCount: number; q: string }>) {
  return render(
    <AccountsTable
      rows={[]}
      list={{ page: 1, pageSize: 20, totalPages: 1, totalCount: 0, q: "", ...list }}
      role="TEACHER"
      basePath={TEACHERS_PATH}
      filters={[]}
    />
  );
}

describe("AccountsTable — page past the end", () => {
  it("says the page is past the end, not that nothing exists or matches", () => {
    currentQuery = "page=5";
    accounts({ page: 5, totalPages: 2, totalCount: 25 });

    expect(screen.getByText("Page 5 is past the end")).not.toBeNull();
    expect(screen.getByText("There are 2 pages of teachers (25 in all).")).not.toBeNull();
    expect(screen.queryByText("No teachers yet")).toBeNull();
    expect(screen.queryByText("No teachers match")).toBeNull();
  });

  it("offers Go to page 1, dropping page but keeping the filters and sort", () => {
    currentQuery = "page=5&district=Alamada&sort=school&q=cruz";
    accounts({ page: 5, totalPages: 2, totalCount: 25, q: "cruz" });

    const href = screen.getByRole("link", { name: "Go to page 1" }).getAttribute("href") as string;
    const [path, qs] = href.split("?");
    const params = new URLSearchParams(qs);
    expect(path).toBe(TEACHERS_PATH);
    expect(params.has("page")).toBe(false);
    expect(params.get("district")).toBe("Alamada");
    expect(params.get("sort")).toBe("school");
    expect(params.get("q")).toBe("cruz");
  });

  it("goes to the bare path when page was the only param", () => {
    currentQuery = "page=9";
    accounts({ page: 9, totalPages: 1, totalCount: 3 });
    expect(screen.getByRole("link", { name: "Go to page 1" }).getAttribute("href")).toBe(TEACHERS_PATH);
  });

  it("uses singular wording for a single page", () => {
    currentQuery = "page=9";
    accounts({ page: 9, totalPages: 1, totalCount: 3 });
    expect(screen.getByText("There is 1 page of teachers (3 in all).")).not.toBeNull();
  });

  it("still shows the pager, and Previous lands on the real last page, not page - 1", () => {
    currentQuery = "page=5";
    accounts({ page: 5, totalPages: 2, totalCount: 25 });

    const previous = screen.getByRole("link", { name: "Previous page" });
    expect(previous.getAttribute("href")).toBe(`${TEACHERS_PATH}?page=2`);
    expect(screen.queryByRole("link", { name: "Next page" })).toBeNull();
  });

  it("an empty list (total 0) is not 'past the end': no pager and the ordinary empty state", () => {
    accounts({ page: 1, totalPages: 1, totalCount: 0 });

    expect(screen.getByText("No teachers yet")).not.toBeNull();
    expect(screen.queryByText(/is past the end/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "teachers pages" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Go to page 1" })).toBeNull();
  });
});

describe("LearnersDirectory — page past the end", () => {
  function directory(list: Partial<{ page: number; totalPages: number; totalCount: number; q: string }>) {
    return render(
      <LearnersDirectory
        rows={[]}
        list={{ page: 1, pageSize: 25, totalPages: 1, totalCount: 0, q: "", ...list }}
        basePath={LEARNERS_PATH}
        filters={[]}
      />
    );
  }

  it("says the page is past the end and offers Go to page 1 with the filters kept", () => {
    currentQuery = "page=40&grade=G3&aral=yes";
    directory({ page: 40, totalPages: 12, totalCount: 290 });

    expect(screen.getByText("Page 40 is past the end")).not.toBeNull();
    expect(screen.getByText("There are 12 pages of learners (290 in all).")).not.toBeNull();
    expect(screen.queryByText("No learners yet")).toBeNull();
    expect(screen.queryByText("No learners match")).toBeNull();

    const href = screen.getByRole("link", { name: "Go to page 1" }).getAttribute("href") as string;
    const [path, qs] = href.split("?");
    const params = new URLSearchParams(qs);
    expect(path).toBe(LEARNERS_PATH);
    expect(params.has("page")).toBe(false);
    expect(params.get("grade")).toBe("G3");
    expect(params.get("aral")).toBe("yes");
  });

  it("keeps the pager so the reader can step back to the real last page", () => {
    currentQuery = "page=40";
    directory({ page: 40, totalPages: 12, totalCount: 290 });
    expect(screen.getByRole("link", { name: "Previous page" }).getAttribute("href")).toBe(
      `${LEARNERS_PATH}?page=12`
    );
  });

  it("an empty directory shows the ordinary empty state and no pager", () => {
    directory({});
    expect(screen.getByText("No learners yet")).not.toBeNull();
    expect(screen.queryByText(/is past the end/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "learners pages" })).toBeNull();
  });

  it("a search with no results is 'No learners match', not past the end", () => {
    directory({ q: "zzz" });
    expect(screen.getByText("No learners match")).not.toBeNull();
    expect(screen.queryByText(/is past the end/)).toBeNull();
  });
});
