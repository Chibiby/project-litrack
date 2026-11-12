import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleted Records must thread `?teachersSort=` into `getArchivedTeachers` and
 * `?sort=` into `getDeletedLearners`; the old archive page once updated the
 * URL while the query's `orderBy` never changed. Teachers load only for a
 * Developer Admin.
 */

const teachersFixture = { rows: [], page: 1, pages: 1, total: 0 };
const learnersFixture = { rows: [], page: 1, pages: 1, total: 0, schools: [] };

const getArchivedTeachers = vi.fn(async (..._args: unknown[]) => teachersFixture);
const getDeletedLearners = vi.fn(async (..._args: unknown[]) => learnersFixture);
let tier: "DEVELOPER" | "DIVISION" = "DEVELOPER";

vi.mock("@/lib/admin/archive", () => ({
  getArchivedTeachers: (...args: unknown[]) => getArchivedTeachers(...(args as [])),
}));
vi.mock("@/lib/learners/deleted-learners", () => ({
  getDeletedLearners: (...args: unknown[]) => getDeletedLearners(...(args as [])),
}));
vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: vi.fn(async () => ({
    user: { role: "SUPER_ADMIN", adminTier: tier, fullName: "Admin Person", email: "admin@example.test" },
    scope: { kind: "division" },
  })),
}));
vi.mock("@/components/admin/deleted-records-view", () => ({ DeletedRecordsView: () => null }));
vi.mock("@/components/admin/admin-page", () => ({ AdminPage: () => null }));
vi.mock("@/components/school-head/school-head-hero", () => ({ SchoolHeadHero: () => null }));

const { default: DeletedRecordsPage } = await import("@/app/admin/monitoring/deleted-records/page");

beforeEach(() => {
  vi.clearAllMocks();
  tier = "DEVELOPER";
});

describe("DeletedRecordsPage — sort and tier wiring", () => {
  it("passes undefined sorts when no query param is present", async () => {
    await DeletedRecordsPage({ searchParams: Promise.resolve({}) });
    expect(getArchivedTeachers).toHaveBeenCalledWith(expect.objectContaining({ teachersSort: undefined }));
    expect(getDeletedLearners).toHaveBeenCalledWith(
      expect.objectContaining({ sort: undefined, withPurgeCounts: true })
    );
  });

  it("threads ?teachersSort= and ?sort= independently", async () => {
    await DeletedRecordsPage({
      searchParams: Promise.resolve({ teachersSort: "alphabetical", sort: "school", teachers: "2", page: "3" }),
    });
    expect(getArchivedTeachers).toHaveBeenCalledWith(
      expect.objectContaining({ teachersSort: "alphabetical", teacherPage: 2 })
    );
    expect(getDeletedLearners).toHaveBeenCalledWith(expect.objectContaining({ sort: "school", page: 3 }));
  });

  it("skips teachers and permanent delete for a Division Admin", async () => {
    tier = "DIVISION";
    await DeletedRecordsPage({ searchParams: Promise.resolve({}) });
    expect(getArchivedTeachers).not.toHaveBeenCalled();
    expect(getDeletedLearners).toHaveBeenCalledWith(expect.objectContaining({ withPurgeCounts: false }));
  });
});
