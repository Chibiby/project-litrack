import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves `/admin/schools/[schoolId]` reads `?learnersSort=` and actually
 * threads it into `getSchoolDetail`'s third argument, rather than dropping it
 * on the floor. `SchoolDetailView` reads its own `learnersSort` copy straight
 * from the URL for the client-side "Sort by" control (see
 * `tests/components/school-detail-view-sort.test.tsx`), so the page's only
 * remaining job for this parameter is passing it into the paginated,
 * server-sorted Prisma query — which is exactly what this file guards
 * against regressing.
 */

const detailFixture = {
  school: {
    id: "school-1",
    name: "Naidas T. Opong ES",
    schoolIdCode: "130554",
    address: null,
    region: null,
    division: null,
    district: null,
    isActive: true,
    isDemo: false,
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  counts: { teachers: 0, learners: 0, sections: 0, gradeLevels: 0, schoolYears: 0 },
  teachers: [],
  learners: [],
  learnerPage: 1,
  learnerPages: 1,
};

const getSchoolDetail = vi.fn(async (..._args: unknown[]) => detailFixture);

vi.mock("@/lib/admin/school-detail", () => ({
  getSchoolDetail: (...args: unknown[]) => getSchoolDetail(...(args as [])),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    role: "SUPER_ADMIN",
    fullName: "Admin Person",
    email: "admin@example.test",
  })),
}));

vi.mock("@/components/admin/school-detail-view", () => ({
  SchoolDetailView: () => null,
}));

const { default: SchoolDetailPage } = await import(
  "@/app/admin/schools/[schoolId]/page"
);

beforeEach(() => {
  vi.clearAllMocks();
  getSchoolDetail.mockResolvedValue(detailFixture);
});

describe("SchoolDetailPage — learner sort wiring reaches getSchoolDetail", () => {
  it("passes undefined when ?learnersSort is absent", async () => {
    await SchoolDetailPage({
      params: Promise.resolve({ schoolId: "school-1" }),
      searchParams: Promise.resolve({}),
    });

    expect(getSchoolDetail).toHaveBeenCalledTimes(1);
    expect(getSchoolDetail).toHaveBeenCalledWith("school-1", 1, undefined);
  });

  it("threads ?learnersSort=grade-level into getSchoolDetail's third argument", async () => {
    await SchoolDetailPage({
      params: Promise.resolve({ schoolId: "school-1" }),
      searchParams: Promise.resolve({ learnersSort: "grade-level" }),
    });

    expect(getSchoolDetail).toHaveBeenCalledWith("school-1", 1, "grade-level");
  });

  it("combines a specific learners page with a sort, without one overriding the other", async () => {
    await SchoolDetailPage({
      params: Promise.resolve({ schoolId: "school-1" }),
      searchParams: Promise.resolve({ learners: "3", learnersSort: "section" }),
    });

    expect(getSchoolDetail).toHaveBeenCalledWith("school-1", 3, "section");
  });
});
