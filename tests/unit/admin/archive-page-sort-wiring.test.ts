import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleted Records loads only the open tab's rows and counts the other tab.
 * `?sort=`, `?page=` and `?perPage=` must reach the open tab's query (the old
 * archive page once updated the URL while the query's `orderBy` never
 * changed), and teachers are a Developer Admin tab only.
 */

const teachersFixture = { rows: [], page: 1, pages: 1, total: 7 };
const learnersFixture = { rows: [], page: 1, pages: 1, total: 3, schools: [] };

const getArchivedTeachers = vi.fn(async (..._args: unknown[]) => teachersFixture);
const countArchivedTeachers = vi.fn(async (..._args: unknown[]) => 7);
const getDeletedLearners = vi.fn(async (..._args: unknown[]) => learnersFixture);
const countDeletedLearners = vi.fn(async (..._args: unknown[]) => 3);
const deletedRecordSchools = vi.fn(async (..._args: unknown[]) => []);
const view = vi.fn((..._args: unknown[]) => null);
let tier: "DEVELOPER" | "DIVISION" = "DEVELOPER";

vi.mock("@/lib/admin/archive", () => ({
  getArchivedTeachers: (...args: unknown[]) => getArchivedTeachers(...args),
  countArchivedTeachers: (...args: unknown[]) => countArchivedTeachers(...args),
}));
vi.mock("@/lib/learners/deleted-learners", () => ({
  getDeletedLearners: (...args: unknown[]) => getDeletedLearners(...args),
  countDeletedLearners: (...args: unknown[]) => countDeletedLearners(...args),
  deletedRecordSchools: (...args: unknown[]) => deletedRecordSchools(...args),
}));
vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: vi.fn(async () => ({
    user: { role: "SUPER_ADMIN", adminTier: tier, fullName: "Admin Person", email: "admin@example.test" },
    scope: { kind: "division" },
  })),
}));
vi.mock("@/components/admin/deleted-records-view", () => ({
  DeletedRecordsView: (props: unknown) => view(props),
}));
vi.mock("@/components/admin/admin-page", () => ({
  AdminPage: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/school-head/school-head-hero", () => ({ SchoolHeadHero: () => null }));

const { default: DeletedRecordsPage } = await import("@/app/admin/monitoring/deleted-records/page");

beforeEach(() => {
  vi.clearAllMocks();
  tier = "DEVELOPER";
});

describe("DeletedRecordsPage — tabs, sort and paging", () => {
  it("opens on Learners and only counts teachers", async () => {
    await DeletedRecordsPage({ searchParams: Promise.resolve({}) });
    expect(getDeletedLearners).toHaveBeenCalledWith(
      expect.objectContaining({ sort: undefined, page: 1, pageSize: 50, withPurgeCounts: true })
    );
    expect(getArchivedTeachers).not.toHaveBeenCalled();
    expect(countArchivedTeachers).toHaveBeenCalledTimes(1);
  });

  it("threads ?tab=teachers with its sort, page and page size, and only counts learners", async () => {
    await DeletedRecordsPage({
      searchParams: Promise.resolve({ tab: "teachers", sort: "alphabetical", page: "2", perPage: "25" }),
    });
    expect(getArchivedTeachers).toHaveBeenCalledWith(
      expect.objectContaining({ teachersSort: "alphabetical", teacherPage: 2, pageSize: 25 })
    );
    expect(getDeletedLearners).not.toHaveBeenCalled();
    expect(countDeletedLearners).toHaveBeenCalledTimes(1);
    expect(deletedRecordSchools).toHaveBeenCalledTimes(1);
  });

  it("falls back to 50 rows on an unknown page size", async () => {
    await DeletedRecordsPage({ searchParams: Promise.resolve({ perPage: "7" }) });
    expect(getDeletedLearners).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }));
  });

  it("gives a Division Admin no Teachers tab and no permanent delete, even with ?tab=teachers", async () => {
    tier = "DIVISION";
    await DeletedRecordsPage({ searchParams: Promise.resolve({ tab: "teachers" }) });
    expect(getArchivedTeachers).not.toHaveBeenCalled();
    expect(countArchivedTeachers).not.toHaveBeenCalled();
    expect(getDeletedLearners).toHaveBeenCalledWith(expect.objectContaining({ withPurgeCounts: false }));
  });
});
