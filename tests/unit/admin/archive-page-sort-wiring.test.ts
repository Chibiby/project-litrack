import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/admin/archive` was found NOT wired: `ArchiveView` (a client component)
 * already reads `?teachersSort=`/`?learnersSort=` straight from the URL for
 * its own dropdowns (see `teachersSort`/`learnersSort` in
 * `src/components/admin/archive-view.tsx`), so choosing a sort re-renders the
 * page with the new query param — but the server page never read that param
 * back out of `searchParams` to pass into `getArchive`, so the actual
 * Prisma `orderBy` never changed: the dropdown updated the URL and nothing
 * else. This test guards the fix (reading both params and threading them into
 * `getArchive`) against regressing back to that silently-inert state.
 */

const archiveFixture = {
  teachers: { rows: [], page: 1, pages: 1, total: 0 },
  learners: { rows: [], page: 1, pages: 1, total: 0 },
};

const getArchive = vi.fn(async (..._args: unknown[]) => archiveFixture);

vi.mock("@/lib/admin/archive", () => ({
  getArchive: (...args: unknown[]) => getArchive(...(args as [])),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    role: "SUPER_ADMIN",
    fullName: "Admin Person",
    email: "admin@example.test",
  })),
}));

vi.mock("@/components/admin/archive-view", () => ({
  ArchiveView: () => null,
}));

const { default: AdminArchivePage } = await import("@/app/admin/archive/page");

beforeEach(() => {
  vi.clearAllMocks();
  getArchive.mockResolvedValue(archiveFixture);
});

describe("AdminArchivePage — sort wiring reaches getArchive", () => {
  it("passes undefined sorts when neither query param is present", async () => {
    await AdminArchivePage({ searchParams: Promise.resolve({}) });

    expect(getArchive).toHaveBeenCalledTimes(1);
    expect(getArchive).toHaveBeenCalledWith(
      expect.objectContaining({ teachersSort: undefined, learnersSort: undefined })
    );
  });

  it("threads ?teachersSort=alphabetical into getArchive", async () => {
    await AdminArchivePage({
      searchParams: Promise.resolve({ teachersSort: "alphabetical" }),
    });

    expect(getArchive).toHaveBeenCalledWith(
      expect.objectContaining({ teachersSort: "alphabetical", learnersSort: undefined })
    );
  });

  it("threads ?learnersSort=school independently of the teachers bucket", async () => {
    await AdminArchivePage({
      searchParams: Promise.resolve({ learnersSort: "school" }),
    });

    expect(getArchive).toHaveBeenCalledWith(
      expect.objectContaining({ teachersSort: undefined, learnersSort: "school" })
    );
  });

  it("carries both sorts at once without one clobbering the other", async () => {
    await AdminArchivePage({
      searchParams: Promise.resolve({
        teachersSort: "school",
        learnersSort: "alphabetical",
      }),
    });

    expect(getArchive).toHaveBeenCalledWith(
      expect.objectContaining({ teachersSort: "school", learnersSort: "alphabetical" })
    );
  });
});
