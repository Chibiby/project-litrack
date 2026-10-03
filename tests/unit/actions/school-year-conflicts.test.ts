import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A P2002 on SchoolYear is two different conditions: the (schoolId, label)
 * unique, and the one-active-year partial unique index. Only the first is a
 * label clash; the second means two activations raced.
 */

const ACTIVE_MSG = "Another school year was just made active. Refresh and try again.";

function p2002(target: unknown, message = "Unique constraint failed") {
  return Object.assign(new Error(message), {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
    meta: target === undefined ? undefined : { target },
  });
}

/** The shape engineType "client" + @prisma/adapter-pg produces: no meta.target. */
function adapterP2002(fields: string[], message?: string) {
  const quoted = fields.map((f) => `"${f}"`);
  return Object.assign(
    new Error(message ?? `Unique constraint failed on the fields: (${quoted.map((f) => `\`${f}\``).join(",")})`),
    {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { kind: "UniqueConstraintViolation", constraint: { fields: quoted } },
        },
      },
    },
  );
}

const transaction = vi.fn();
const findFirst = vi.fn();
const update = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: unknown[]) => transaction(...a),
    schoolYear: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: vi.fn(async () => ({
    id: "user-1",
    schoolId: "school-1",
    role: "SCHOOL_HEAD" as const,
    profileCompleted: true,
  })),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async () => {}),
  AUDIT_ACTIONS: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateSchoolDashboard: vi.fn() }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TEST0001") }));

const { createSchoolYear, setActiveSchoolYear, updateSchoolYear } = await import(
  "@/lib/actions/school-year"
);

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const createForm = () =>
  form({ label: "2026-2027", startDate: "2026-06-08", endDate: "2027-03-31", setActive: "true" });
const YEAR_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue({ id: YEAR_ID, label: "2025-2026" });
});

describe("createSchoolYear P2002 mapping", () => {
  it("label target (array) reads as a label clash", async () => {
    transaction.mockRejectedValue(p2002(["schoolId", "label"]));
    const res = await createSchoolYear(createForm());
    expect(res).toMatchObject({ ok: false, error: "A school year with this label already exists" });
  });

  it("label target (string index name) reads as a label clash", async () => {
    transaction.mockRejectedValue(p2002("SchoolYear_schoolId_label_key"));
    const res = await createSchoolYear(createForm());
    expect(res).toMatchObject({ ok: false, error: "A school year with this label already exists" });
  });

  it("active-year index (string target) is NOT a label clash", async () => {
    transaction.mockRejectedValue(p2002("SchoolYear_school_active_unique"));
    const res = await createSchoolYear(createForm());
    expect(res).toMatchObject({ ok: false, error: ACTIVE_MSG });
  });

  it("active-year index (schoolId-only array target) is NOT a label clash", async () => {
    transaction.mockRejectedValue(p2002(["schoolId"]));
    const res = await createSchoolYear(createForm());
    expect(res).toMatchObject({ ok: false, error: ACTIVE_MSG });
  });
});

describe("createSchoolYear P2002 mapping, real adapter shape", () => {
  it("fields [schoolId] is the active-year conflict", async () => {
    transaction.mockRejectedValue(adapterP2002(["schoolId"]));
    expect(await createSchoolYear(createForm())).toMatchObject({ ok: false, error: ACTIVE_MSG });
  });

  it("fields [schoolId, label] is a label clash", async () => {
    transaction.mockRejectedValue(adapterP2002(["schoolId", "label"]));
    expect(await createSchoolYear(createForm())).toMatchObject({
      ok: false,
      error: "A school year with this label already exists",
    });
  });

  it("fields [label, schoolId] (other order) is a label clash", async () => {
    transaction.mockRejectedValue(adapterP2002(["label", "schoolId"]));
    expect(await createSchoolYear(createForm())).toMatchObject({
      ok: false,
      error: "A school year with this label already exists",
    });
  });

  it("message-only fallback: active year", async () => {
    transaction.mockRejectedValue(p2002(undefined, "Unique constraint failed on the fields: (`\"schoolId\"`)"));
    expect(await createSchoolYear(createForm())).toMatchObject({ ok: false, error: ACTIVE_MSG });
  });

  it("message-only fallback: label", async () => {
    transaction.mockRejectedValue(
      p2002(undefined, "Unique constraint failed on the fields: (`schoolId`,`label`)"),
    );
    expect(await createSchoolYear(createForm())).toMatchObject({
      ok: false,
      error: "A school year with this label already exists",
    });
  });

  it("P2002 on an unrelated target is neither mapping and is rethrown", async () => {
    transaction.mockRejectedValue(adapterP2002(["startDate"]));
    const res = await createSchoolYear(createForm());
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).not.toBe(ACTIVE_MSG);
    expect((res as { error: string }).error).not.toBe("A school year with this label already exists");
  });
});

describe("setActiveSchoolYear P2002 mapping", () => {
  it("maps the active-year index to a friendly conflict", async () => {
    transaction.mockRejectedValue(p2002("SchoolYear_school_active_unique"));
    const res = await setActiveSchoolYear(form({ schoolYearId: YEAR_ID }));
    expect(res).toMatchObject({ ok: false, error: ACTIVE_MSG });
  });

  it("maps a schoolId-only array target the same way", async () => {
    transaction.mockRejectedValue(p2002(["schoolId"]));
    const res = await setActiveSchoolYear(form({ schoolYearId: YEAR_ID }));
    expect(res).toMatchObject({ ok: false, error: ACTIVE_MSG });
  });
});

describe("updateSchoolYear P2002 mapping", () => {
  it("still maps the label unique", async () => {
    update.mockRejectedValue(p2002(["schoolId", "label"]));
    const res = await updateSchoolYear(
      form({ schoolYearId: YEAR_ID, label: "2026-2027", startDate: "2026-06-08", endDate: "2027-03-31" })
    );
    expect(res).toMatchObject({ ok: false, error: "Another school year already uses this label" });
  });
});
