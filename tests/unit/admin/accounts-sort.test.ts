import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/lib/admin/accounts.ts` — "Sort by" registry, orderBy mapper, and the
 * surname-first `listingName` display field. Companion to `accounts.test.ts`,
 * which pins the 2-query bound and password-state mapping.
 */

const SCHOOL = { id: "school-1", name: "Naidas T. Opong ES", schoolIdCode: "130554" };

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    role: "TEACHER",
    fullName: "Juana Cruz",
    firstName: "Juana",
    middleName: null,
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
    groupBy: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  ACCOUNT_LIST_SORTS,
  accountsListOrderBy,
  getAccountsPage,
  parseAccountsParams,
} = await import("@/lib/admin/accounts");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findMany.mockResolvedValue([baseUser()]);
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.user.groupBy.mockResolvedValue([]);
});

describe("ACCOUNT_LIST_SORTS.parse", () => {
  it("accepts each allow-listed sort value", () => {
    for (const option of ACCOUNT_LIST_SORTS.options) {
      expect(ACCOUNT_LIST_SORTS.parse(option.value)).toBe(option.value);
    }
  });

  it("falls back to alphabetical for garbage/undefined", () => {
    expect(ACCOUNT_LIST_SORTS.parse("not-a-real-sort")).toBe("alphabetical");
    expect(ACCOUNT_LIST_SORTS.parse(undefined)).toBe("alphabetical");
  });
});

describe("parseAccountsParams — sort", () => {
  it("defaults ?sort to alphabetical when omitted", () => {
    expect(parseAccountsParams({}).sort).toBe("alphabetical");
  });

  it("threads a valid ?sort through and falls back on an unknown one", () => {
    expect(parseAccountsParams({ sort: "role" }).sort).toBe("role");
    expect(parseAccountsParams({ sort: "bogus" }).sort).toBe("alphabetical");
  });
});

describe("accountsListOrderBy — exhaustiveness and tiebreaker", () => {
  it("returns a non-empty orderBy array for every option", () => {
    for (const option of ACCOUNT_LIST_SORTS.options) {
      expect(accountsListOrderBy(option.value).length).toBeGreaterThan(0);
    }
  });

  it("every option's orderBy array terminates in the id tiebreaker", () => {
    for (const option of ACCOUNT_LIST_SORTS.options) {
      const orderBy = accountsListOrderBy(option.value);
      expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
    }
  });

  it("alphabetical orders by lastName then firstName, not fullName", () => {
    const orderBy = accountsListOrderBy("alphabetical");
    expect(orderBy[0]).toEqual({ lastName: "asc" });
    expect(orderBy[1]).toEqual({ firstName: "asc" });
    expect(orderBy).not.toContainEqual({ fullName: "asc" });
  });

  it("role and school sorts still tiebreak on name before id", () => {
    expect(accountsListOrderBy("role").slice(0, 3)).toEqual([
      { role: "asc" },
      { lastName: "asc" },
      { firstName: "asc" },
    ]);
    expect(accountsListOrderBy("school").slice(0, 3)).toEqual([
      { school: { name: "asc" } },
      { lastName: "asc" },
      { firstName: "asc" },
    ]);
  });
});

describe("getAccountsPage — orderBy wiring", () => {
  it("passes the parsed sort's orderBy to findMany", async () => {
    await getAccountsPage(parseAccountsParams({ sort: "date-added" }));
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: accountsListOrderBy("date-added") })
    );
  });

  it("defaults to the alphabetical orderBy when no sort is given", async () => {
    await getAccountsPage(parseAccountsParams({}));
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: accountsListOrderBy("alphabetical") })
    );
  });
});

describe("getAccountsPage — listingName", () => {
  it("renders surname-first with no middle name", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({ firstName: "Juana", middleName: null, lastName: "Cruz" }),
    ]);
    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].listingName).toBe("Cruz, Juana");
  });

  it("renders surname-first with a middle name", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({ firstName: "Juana", middleName: "Reyes", lastName: "Cruz" }),
    ]);
    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].listingName).toBe("Cruz, Juana Reyes");
  });

  it("falls back to the given name with no leading comma for a blank surname", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({ firstName: "Juana", middleName: null, lastName: "" }),
    ]);
    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].listingName).toBe("Juana");
  });

  it("does not replace the existing fullName fallback", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseUser({ fullName: "", firstName: "Juana", lastName: "Cruz" }),
    ]);
    const page = await getAccountsPage(parseAccountsParams({}));
    expect(page.rows[0].fullName).toBe("Juana Cruz");
    expect(page.rows[0].listingName).toBe("Cruz, Juana");
  });
});
