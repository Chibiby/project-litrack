import { beforeEach, describe, expect, it, vi } from "vitest";
import { resourceNotFound as resourceNotFoundReal } from "@/lib/errors/app-error";

/**
 * `searchActiveLearners` (`src/lib/actions/search-learners.ts`) — the
 * district admin branch added so `/district/transfers` can pick a learner.
 *
 * Same "dumb fake vs. faithful fake" split as
 * `tests/unit/actions/district-school-management.test.ts`: `loadSchoolInScope`
 * is mocked here as a fake that enforces the scope itself, so if the source
 * stopped calling it before reading learners, the out-of-scope case would
 * silently search anyway and this test would go red.
 */

type Scope = { kind: "division" } | { kind: "districts"; districts: readonly string[] };

const SCHOOL_IN_SCOPE = { id: "11111111-1111-4111-8111-111111111111", district: "Alabel 1" };
const SCHOOL_OUT_OF_SCOPE = { id: "22222222-2222-4222-8222-222222222222", district: "Glan 1" };
const SCHOOLS: Record<string, { id: string; district: string }> = {
  [SCHOOL_IN_SCOPE.id]: SCHOOL_IN_SCOPE,
  [SCHOOL_OUT_OF_SCOPE.id]: SCHOOL_OUT_OF_SCOPE,
};

function schoolInScope(scope: Scope, school: { district: string }): boolean {
  if (scope.kind === "division") return true;
  return scope.districts.includes(school.district);
}

let scope: Scope = { kind: "districts", districts: ["Alabel 1"] };
const DA_ID = "da-1";
const actor = { id: DA_ID, role: "DISTRICT_ADMIN" as const, schoolId: null };

const requireAdminScope = vi.fn(async () => ({ user: actor, scope }));
const loadSchoolInScope = vi.fn(async (s: Scope, schoolId: string, _select?: unknown) => {
  const school = SCHOOLS[schoolId];
  if (!school || !schoolInScope(s, school)) {
    throw resourceNotFoundReal("School", { crossTenant: true });
  }
  return school;
});
vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: (...a: unknown[]) => requireAdminScope(...(a as [])),
  loadSchoolInScope: (...a: unknown[]) => loadSchoolInScope(...(a as [Scope, string, unknown])),
}));

const requireUser = vi.fn(async (_roles?: unknown): Promise<{ id: string; role: string; schoolId: string | null }> => actor);
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...(a as [unknown])),
}));

const learnerFindMany = vi.fn(async (_args: unknown): Promise<unknown[]> => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      findMany: (...a: unknown[]) => learnerFindMany(...(a as [never])),
    },
  },
}));

const { searchActiveLearners } = await import("@/lib/actions/search-learners");

beforeEach(() => {
  vi.clearAllMocks();
  scope = { kind: "districts", districts: ["Alabel 1"] };
  requireAdminScope.mockImplementation(async () => ({ user: actor, scope }));
  requireUser.mockImplementation(async () => actor);
  learnerFindMany.mockResolvedValue([]);
});

describe("searchActiveLearners — district admin scope", () => {
  it("refuses an out-of-scope schoolId with NOT_FOUND and runs no learner query", async () => {
    const res = await searchActiveLearners({ schoolId: SCHOOL_OUT_OF_SCOPE.id, q: "juan" });

    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      error: "School not found. It may have been deleted or moved.",
    });
    expect(loadSchoolInScope).toHaveBeenCalledWith(scope, SCHOOL_OUT_OF_SCOPE.id, expect.anything());
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("searches an in-scope school", async () => {
    const res = await searchActiveLearners({ schoolId: SCHOOL_IN_SCOPE.id, q: "juan" });

    expect(res).toMatchObject({ ok: true });
    expect(learnerFindMany).toHaveBeenCalledTimes(1);
    const args = learnerFindMany.mock.calls[0]?.[0] as { where: { schoolId: string } };
    expect(args.where.schoolId).toBe(SCHOOL_IN_SCOPE.id);
  });

  it("never calls requireAdminScope for a School Head or Super Admin (behaviour unchanged)", async () => {
    requireUser.mockImplementation(async () => ({ id: "head-1", role: "SCHOOL_HEAD", schoolId: SCHOOL_IN_SCOPE.id }));

    const res = await searchActiveLearners({ schoolId: SCHOOL_IN_SCOPE.id, q: "juan" });

    expect(res).toMatchObject({ ok: true });
    expect(requireAdminScope).not.toHaveBeenCalled();
    expect(loadSchoolInScope).not.toHaveBeenCalled();
  });
});
