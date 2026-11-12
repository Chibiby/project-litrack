import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * School-year actions after the 2026-11-12 split: the Division Admin creates a
 * year for every school and activates it; a School Head only sets months, and
 * only on their own school's years. A P2002 from the one-active-year partial
 * unique index means two activations raced.
 */

const ACTIVE_MSG = "Another school year was just made active. Refresh and try again.";

function p2002(target: unknown) {
  return Object.assign(new Error("Unique constraint failed"), {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
    meta: { target },
  });
}

const transaction = vi.fn();
const findFirst = vi.fn();
const update = vi.fn();
const schoolFindMany = vi.fn();
const schoolCount = vi.fn();
const requireUser = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: unknown[]) => transaction(...a),
    schoolYear: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
    school: {
      findMany: (...a: unknown[]) => schoolFindMany(...a),
      count: (...a: unknown[]) => schoolCount(...a),
    },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: (...a: unknown[]) => requireUser(...a) }));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async () => {}),
  AUDIT_ACTIONS: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: vi.fn(),
  revalidateAdminDashboard: vi.fn(),
  revalidateAllCachedData: vi.fn(),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TEST0001") }));

const { createDivisionSchoolYear, setActiveSchoolYear, setSchoolYearMonths } = await import(
  "@/lib/actions/school-year"
);

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ADMIN = { id: "admin-1", schoolId: null, role: "SUPER_ADMIN" as const };
const HEAD = { id: "head-1", schoolId: "school-1", role: "SCHOOL_HEAD" as const };
const YEAR_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(ADMIN);
  findFirst.mockResolvedValue({
    id: YEAR_ID,
    schoolId: "school-1",
    label: "2026-2027",
    startDate: new Date(Date.UTC(2026, 5, 8)),
    endDate: null,
  });
});

describe("createDivisionSchoolYear", () => {
  const createForm = () =>
    form({ label: "2027-2028", startMonth: "2027-06", endMonth: "", setActive: "true" });

  it("is guarded by requireUser('SUPER_ADMIN')", async () => {
    schoolFindMany.mockResolvedValue([{ id: "s1" }]);
    schoolCount.mockResolvedValue(1);
    transaction.mockResolvedValue(undefined);
    await createDivisionSchoolYear(createForm());
    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
  });

  it("creates the year for every school that lacks it and reports the rest", async () => {
    schoolFindMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    schoolCount.mockResolvedValue(5);
    const createMany = vi.fn();
    const updateMany = vi.fn();
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ schoolYear: { createMany, updateMany } })
    );

    const res = await createDivisionSchoolYear(createForm());

    expect(res).toEqual({ ok: true, created: 2, skipped: 3 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { schoolId: { in: ["s1", "s2"] }, isActive: true },
      data: { isActive: false },
    });
    const rows = createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      schoolId: "s1",
      label: "2027-2028",
      startDate: new Date(Date.UTC(2027, 5, 1)),
      endDate: null,
      isActive: true,
    });
  });

  it("refuses when every school already has the label", async () => {
    schoolFindMany.mockResolvedValue([]);
    schoolCount.mockResolvedValue(5);
    const res = await createDivisionSchoolYear(createForm());
    expect(res).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("maps the active-year index to a friendly conflict", async () => {
    schoolFindMany.mockResolvedValue([{ id: "s1" }]);
    schoolCount.mockResolvedValue(1);
    transaction.mockRejectedValue(p2002("SchoolYear_school_active_unique"));
    const res = await createDivisionSchoolYear(createForm());
    expect(res).toMatchObject({ ok: false, error: ACTIVE_MSG });
  });
});

describe("setActiveSchoolYear", () => {
  it("is Division Admin only", async () => {
    transaction.mockResolvedValue(undefined);
    await setActiveSchoolYear(form({ schoolYearId: YEAR_ID }));
    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
  });

  it("maps the active-year index to a friendly conflict", async () => {
    transaction.mockRejectedValue(p2002(["schoolId"]));
    const res = await setActiveSchoolYear(form({ schoolYearId: YEAR_ID }));
    expect(res).toMatchObject({ ok: false, error: ACTIVE_MSG });
  });
});

describe("setSchoolYearMonths", () => {
  it("scopes a School Head to their own school", async () => {
    requireUser.mockResolvedValue(HEAD);
    update.mockResolvedValue({});
    await setSchoolYearMonths(form({ schoolYearId: YEAR_ID, startMonth: "2026-07", endMonth: "" }));
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: YEAR_ID, schoolId: "school-1" });
  });

  it("stores the first day of the start month and a null end when blank", async () => {
    requireUser.mockResolvedValue(HEAD);
    update.mockResolvedValue({});
    const res = await setSchoolYearMonths(
      form({ schoolYearId: YEAR_ID, startMonth: "2026-07", endMonth: "" })
    );
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: YEAR_ID },
      data: { startDate: new Date(Date.UTC(2026, 6, 1)), endDate: null },
    });
  });

  it("stores the last day of the end month", async () => {
    requireUser.mockResolvedValue(HEAD);
    update.mockResolvedValue({});
    await setSchoolYearMonths(
      form({ schoolYearId: YEAR_ID, startMonth: "2026-06", endMonth: "2027-02" })
    );
    expect(update.mock.calls[0][0].data.endDate).toEqual(new Date(Date.UTC(2027, 1, 28)));
  });

  it("reads another school's year as not found", async () => {
    requireUser.mockResolvedValue(HEAD);
    findFirst.mockResolvedValue(null);
    const res = await setSchoolYearMonths(form({ schoolYearId: YEAR_ID, startMonth: "2026-06" }));
    expect(res).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("lets a Division Admin set months at any school", async () => {
    update.mockResolvedValue({});
    await setSchoolYearMonths(form({ schoolYearId: YEAR_ID, startMonth: "2026-06" }));
    expect(findFirst.mock.calls[0][0].where).not.toHaveProperty("schoolId");
  });
});
