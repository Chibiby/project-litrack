import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

/**
 * `globalSearch` (`src/lib/actions/global-search.ts`) — the header search shared
 * by every role.
 *
 * Two things matter here and nowhere else in this suite:
 *
 *   1. It refuses before it queries anything, the same as every other action
 *      (`requireUser` throws a redirect, which is a throw carrying a `digest`,
 *      not a returned `{ ok: false }` — see `term-subject-defaults.test.ts`).
 *   2. No branch can leak a row out of the caller's own school. The learner
 *      fake below is "faithful" rather than dumb: it filters by the `schoolId`
 *      the source actually passed, so a regression that dropped the tenant
 *      predicate would show up here as another school's learner in the
 *      result, not as a mock that silently agreed to return everything.
 */

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

let scope: { kind: "division" } | { kind: "districts"; districts: readonly string[] } = {
  kind: "districts",
  districts: ["Alabel 1"],
};
const requireAdminScope = vi.fn(async () => ({ scope }));
vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: (...a: unknown[]) => requireAdminScope(...(a as [])),
}));

vi.mock("@/lib/auth/admin-scope", () => ({
  schoolWhereForScope: (s: { kind: string; districts?: readonly string[] }) =>
    s.kind === "division" ? {} : { district: { in: s.districts } },
}));

vi.mock("@/lib/teachers/scope", () => ({
  teacherLearnerScope: (id: string) => ({ aralTutorId: id }),
}));

vi.mock("@/lib/constants/enum-labels", () => ({
  GRADE_LEVEL_LABELS: { GRADE_1: "Grade 1" },
}));

vi.mock("@/lib/routes/district", () => ({
  DISTRICT_ROUTES: { school: (id: string) => `/district/schools/${id}` },
}));

type LearnerRow = {
  id: string;
  fullName: string;
  schoolId: string;
  gradeLevelId: string;
  gradeLevel: { type: string };
  section: null;
};

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";

const ALL_LEARNERS: LearnerRow[] = [
  {
    id: "l-a1",
    fullName: "Maria Apple",
    schoolId: SCHOOL_A,
    gradeLevelId: "g1",
    gradeLevel: { type: "GRADE_1" },
    section: null,
  },
  {
    id: "l-b1",
    fullName: "Maria Banana",
    schoolId: SCHOOL_B,
    gradeLevelId: "g1",
    gradeLevel: { type: "GRADE_1" },
    section: null,
  },
];

type FindManyArgs = { where: Record<string, unknown> };

/** Filters by the `schoolId` the source actually queried with — never a dumb stub. */
const learnerFindMany = vi.fn(async (args: FindManyArgs) => {
  const schoolId = args.where.schoolId as string | undefined;
  return ALL_LEARNERS.filter((l) => (schoolId ? l.schoolId === schoolId : true));
});
const userFindMany = vi.fn(async (_args: FindManyArgs) => [] as unknown[]);
const sectionFindMany = vi.fn(async (_args: FindManyArgs) => [] as unknown[]);
const schoolFindMany = vi.fn(async (_args: FindManyArgs) => [] as unknown[]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { findMany: (...a: unknown[]) => learnerFindMany(...(a as [FindManyArgs])) },
    user: { findMany: (...a: unknown[]) => userFindMany(...(a as [FindManyArgs])) },
    section: { findMany: (...a: unknown[]) => sectionFindMany(...(a as [FindManyArgs])) },
    school: { findMany: (...a: unknown[]) => schoolFindMany(...(a as [FindManyArgs])) },
  },
}));

const { globalSearch } = await import("@/lib/actions/global-search");

const SCHOOL_HEAD = { id: "head-1", role: "SCHOOL_HEAD" as const, schoolId: SCHOOL_A };

beforeEach(() => {
  vi.clearAllMocks();
  scope = { kind: "districts", districts: ["Alabel 1"] };
  requireAdminScope.mockImplementation(async () => ({ scope }));
  requireUser.mockResolvedValue(SCHOOL_HEAD);
});

describe("globalSearch — authorization", () => {
  it("refuses an unauthenticated caller before querying anything", async () => {
    requireUser.mockImplementation(async () => {
      redirect("/login");
    });

    await expect(globalSearch({ q: "maria" })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(learnerFindMany).not.toHaveBeenCalled();
  });
});

describe("globalSearch — tenancy", () => {
  it("a School Head sees only their own school's learners, never another school's", async () => {
    const res = await globalSearch({ q: "maria" });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok:true");
    const ids = res.data.map((hit) => hit.id);
    expect(ids).toContain("l-a1");
    expect(ids).not.toContain("l-b1");
    expect(learnerFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { schoolId: SCHOOL_A } });
  });

  it("a Teacher is further scoped to their own learners and never reaches staff, sections or schools", async () => {
    requireUser.mockResolvedValue({ id: "t-1", role: "TEACHER", schoolId: SCHOOL_A });

    const res = await globalSearch({ q: "maria" });

    expect(res.ok).toBe(true);
    expect(learnerFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { schoolId: SCHOOL_A, aralTutorId: "t-1" },
    });
    expect(userFindMany).not.toHaveBeenCalled();
    expect(sectionFindMany).not.toHaveBeenCalled();
    expect(schoolFindMany).not.toHaveBeenCalled();
  });

  it("a non-admin with no school matches nothing rather than dropping the tenant predicate", async () => {
    requireUser.mockResolvedValue({ id: "orphan-1", role: "SCHOOL_HEAD", schoolId: null });

    const res = await globalSearch({ q: "maria" });

    expect(res).toEqual({ ok: true, data: [] });
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("only a Super Admin searches across schools", async () => {
    requireUser.mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN", schoolId: null });

    const res = await globalSearch({ q: "maria" });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok:true");
    const ids = res.data.map((hit) => hit.id);
    expect(ids).toEqual(expect.arrayContaining(["l-a1", "l-b1"]));
    const args = learnerFindMany.mock.calls[0]?.[0] as FindManyArgs;
    expect(args.where.schoolId).toBeUndefined();
  });

  it("a District Admin is scoped to schools in their own districts and never queries learners", async () => {
    requireUser.mockResolvedValue({ id: "da-1", role: "DISTRICT_ADMIN", schoolId: null });
    schoolFindMany.mockResolvedValue([
      { id: SCHOOL_A, name: "School A", district: "Alabel 1" },
    ]);

    const res = await globalSearch({ q: "school" });

    expect(res.ok).toBe(true);
    expect(learnerFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
    expect(schoolFindMany).toHaveBeenCalledTimes(1);
    const args = schoolFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ district: { in: ["Alabel 1"] } });
  });
});
