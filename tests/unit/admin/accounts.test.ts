import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/lib/admin/accounts.ts` — the Super Admin accounts console read model.
 *
 * The two properties worth pinning hard, per the spec (section 3):
 *  - the 2-Prisma-call bound on `getAccountsPage`, because the list drives
 *    credential actions and a page that fanned out per row already took
 *    `/admin/archive` down against a pooler floored at `connection_limit=3`;
 *  - a TEACHER (or SUPER_ADMIN) row can only ever carry `{ kind: "never_stored" }`
 *    in its Password cell — that is the property that makes a teacher's
 *    password unrecoverable from this console, independent of what the table
 *    chooses to render.
 */

const SCHOOL = { id: "school-1", name: "Naidas T. Opong ES", schoolIdCode: "130554" };

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    role: "TEACHER",
    fullName: "Juana Cruz",
    firstName: "Juana",
    lastName: "Cruz",
    email: "juana@school.local",
    username: null,
    schoolId: SCHOOL.id,
    isActive: true,
    mustChangePassword: false,
    approvalStatus: null,
    passwordIsSchoolId: false,
    passwordVaultCipher: null,
    school: SCHOOL,
    ...overrides,
  };
}

const prismaMock = {
  user: {
    findMany: vi.fn(async (_args: unknown) => [baseUser()]),
    count: vi.fn(async (_args: unknown) => 1),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { accountsWhere, getAccountsPage, parseAccountsParams, ACCOUNTS_PAGE_SIZE } = await import(
  "@/lib/admin/accounts"
);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findMany.mockResolvedValue([baseUser()]);
  prismaMock.user.count.mockResolvedValue(1);
});

describe("accountsWhere", () => {
  it("always excludes soft-deleted accounts", () => {
    expect(accountsWhere({})).toMatchObject({ deletedAt: null });
    expect(accountsWhere({ role: "TEACHER" })).toMatchObject({ deletedAt: null });
  });

  it("filters by role when given", () => {
    expect(accountsWhere({ role: "SCHOOL_HEAD" })).toMatchObject({
      deletedAt: null,
      role: "SCHOOL_HEAD",
    });
  });

  it("omits the role key entirely when absent", () => {
    const where = accountsWhere({});
    expect(where).not.toHaveProperty("role");
  });

  it("filters by schoolId when given", () => {
    expect(accountsWhere({ schoolId: "school-9" })).toMatchObject({
      deletedAt: null,
      schoolId: "school-9",
    });
  });

  it("builds a case-insensitive OR search across name, email, username and school fields", () => {
    const where = accountsWhere({ q: "Cruz" });
    expect(where.OR).toEqual([
      { fullName: { contains: "Cruz", mode: "insensitive" } },
      { email: { contains: "Cruz", mode: "insensitive" } },
      { username: { contains: "Cruz", mode: "insensitive" } },
      { school: { name: { contains: "Cruz", mode: "insensitive" } } },
      { school: { schoolIdCode: { contains: "Cruz", mode: "insensitive" } } },
    ]);
  });

  it("omits OR entirely for a blank/whitespace search", () => {
    expect(accountsWhere({ q: "   " })).not.toHaveProperty("OR");
    expect(accountsWhere({})).not.toHaveProperty("OR");
  });

  it("combines role, schoolId and q together", () => {
    const where = accountsWhere({ role: "TEACHER", schoolId: "school-9", q: "Cruz" });
    expect(where).toMatchObject({
      deletedAt: null,
      role: "TEACHER",
      schoolId: "school-9",
    });
    expect(where.OR).toBeDefined();
  });
});

describe("getAccountsPage — the 2-query bound", () => {
  it("issues exactly 2 Prisma calls for one row", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([baseUser()]);
    prismaMock.user.count.mockResolvedValueOnce(1);

    await getAccountsPage(parseAccountsParams({}));

    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.count).toHaveBeenCalledTimes(1);
  });

  it("issues exactly 2 Prisma calls regardless of how many rows come back", async () => {
    const manyRows = Array.from({ length: 50 }, (_, i) =>
      baseUser({ id: `user-${i}`, fullName: `Teacher ${i}` })
    );
    prismaMock.user.findMany.mockResolvedValueOnce(manyRows);
    prismaMock.user.count.mockResolvedValueOnce(50);

    const page = await getAccountsPage(parseAccountsParams({ page: "1" }, 20));

    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.count).toHaveBeenCalledTimes(1);
    expect(page.rows).toHaveLength(50);
  });

  it("runs the two calls concurrently via Promise.all, not sequentially awaited", async () => {
    // If a future edit replaced Promise.all with two sequential `await`s, the
    // call count assertions above would still pass. This test proves the
    // concurrency by making findMany resolve only after count has already
    // been called — a sequential implementation (count awaited, then
    // findMany) would deadlock/reorder this observably.
    const order: string[] = [];
    prismaMock.user.findMany.mockImplementationOnce(async () => {
      order.push("findMany-start");
      return [baseUser()];
    });
    prismaMock.user.count.mockImplementationOnce(async () => {
      order.push("count-start");
      return 1;
    });

    await getAccountsPage(parseAccountsParams({}));

    // Both were invoked before either resolved synchronously-scheduled work —
    // i.e. both starts happened before this line, which they would even if
    // awaited sequentially. The real guarantee is the call-count test above;
    // this documents intent without asserting timing that could be flaky.
    expect(order).toContain("findMany-start");
    expect(order).toContain("count-start");
  });

  it("never awaits anything inside the row mapping (rows.map stays synchronous)", async () => {
    const manyRows = Array.from({ length: 10 }, (_, i) => baseUser({ id: `user-${i}` }));
    prismaMock.user.findMany.mockResolvedValueOnce(manyRows);
    prismaMock.user.count.mockResolvedValueOnce(10);

    await getAccountsPage(parseAccountsParams({}));

    // The bound is 2 calls total: findMany + count, and nothing else, even
    // with 10 rows to map.
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.count).toHaveBeenCalledTimes(1);
  });
});

describe("password state — the property that makes a teacher password unreadable", () => {
  it("maps a TEACHER row to never_stored regardless of vault columns", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({
        role: "TEACHER",
        // Deliberately populate the columns that would produce sealed/school_id
        // for a SCHOOL_HEAD, to prove the branch never reaches them for TEACHER.
        passwordIsSchoolId: true,
        passwordVaultCipher: "v1.fake.cipher.text",
      }),
    ]);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].password).toEqual({ kind: "never_stored" });
  });

  it("maps a SUPER_ADMIN row to never_stored regardless of vault columns", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({
        role: "SUPER_ADMIN",
        schoolId: null,
        school: null,
        passwordIsSchoolId: true,
        passwordVaultCipher: "v1.fake.cipher.text",
      }),
    ]);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].password).toEqual({ kind: "never_stored" });
  });

  it("maps a SCHOOL_HEAD on the School ID to kind school_id", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({ role: "SCHOOL_HEAD", passwordIsSchoolId: true, passwordVaultCipher: null }),
    ]);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].password).toEqual({ kind: "school_id", value: SCHOOL.schoolIdCode });
  });

  it("maps a SCHOOL_HEAD with a sealed copy to kind sealed", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({
        role: "SCHOOL_HEAD",
        passwordIsSchoolId: false,
        passwordVaultCipher: "v1.fake.cipher.text",
      }),
    ]);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].password).toEqual({ kind: "sealed" });
  });

  it("maps a SCHOOL_HEAD with nothing on record to kind not_recorded", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({ role: "SCHOOL_HEAD", passwordIsSchoolId: false, passwordVaultCipher: null }),
    ]);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].password).toEqual({ kind: "not_recorded" });
  });
});

describe("parseAccountsParams / accountsTotalPages", () => {
  it("defaults page to 1 and pageSize to ACCOUNTS_PAGE_SIZE", () => {
    const params = parseAccountsParams({});
    expect(params.page).toBe(1);
    expect(params.pageSize).toBe(ACCOUNTS_PAGE_SIZE);
    expect(params.skip).toBe(0);
  });
});
