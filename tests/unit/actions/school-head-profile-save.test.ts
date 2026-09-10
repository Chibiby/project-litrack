import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Action-level coverage for the two fields the School Head profiling form gained:
 * an editable survey contact email and a selectable position.
 *
 * The contact email is the interesting one. `SchoolHeadProfile.contactEmail` is
 * nullable and the Zod primitive turns a blank field into `undefined` — which
 * Prisma reads as "leave this column alone". Passed straight through, a head who
 * deleted their address and saved would keep the old one, with the form showing
 * it gone. So the action has to normalize absence to an explicit null, and these
 * tests are what hold that.
 *
 * Only leaf infrastructure is mocked (Prisma, session, audit, cache). The real
 * `schoolHeadProfileSchema` runs, so a rule that changes there is caught here.
 */

const HEAD_ID = "head-1";
const SCHOOL_ID = "school-1";

type UpsertArgs = {
  where: { userId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

let profileUpsert: UpsertArgs[];
let userUpdate: unknown[];

const prismaMock = {
  user: {
    update: vi.fn(async (args: unknown) => {
      userUpdate.push(args);
      return {};
    }),
  },
  schoolHeadProfile: {
    upsert: vi.fn(async (args: UpsertArgs) => {
      profileUpsert.push(args);
      return {};
    }),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const requireUser = vi.fn(async () => ({
  id: HEAD_ID,
  schoolId: SCHOOL_ID,
  firstName: "Maria",
  middleName: null,
  lastName: "Santos",
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
  requireSchoolUser: vi.fn(),
}));

const writeAudit = vi.fn(async () => {});
const writeAuditMany = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [])),
  writeAuditMany: (...args: unknown[]) => writeAuditMany(...(args as [])),
  AUDIT_ACTIONS: {
    SCHOOL_HEAD_PROFILE_SAVE: "SCHOOL_HEAD_PROFILE_SAVE",
    GRADE_LEVEL_CREATE: "GRADE_LEVEL_CREATE",
    SECTION_CREATE: "SECTION_CREATE",
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolHeadTeachers: vi.fn(),
  revalidateSchoolsList: vi.fn(),
  revalidateTeacherCaches: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/auth/delete-auth-user", () => ({ deleteAuthUser: vi.fn() }));

const { saveSchoolHeadProfile } = await import("@/lib/actions/school-head");

/**
 * A valid settings-profile submission. `skipSchoolStructure` keeps the grade /
 * section bootstrap out of the way — it is the wizard's last step, not part of
 * what these tests are about. An override of `""` omits the key entirely, the
 * way a browser omits a field it never rendered.
 */
function buildFormData(overrides: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    firstName: "Maria",
    lastName: "Santos",
    designation: "School Head",
    position: "PRINCIPAL_I",
    contactEmail: "head@school.deped.gov.ph",
    educationalAttainment: "BACHELORS",
    fieldOfSpecialization: "ENGLISH",
    yearsInService: "4",
    hasReadingTraining: "false",
    hasEnglishTraining: "false",
    highestTrainingLevel: "DIVISION",
    skipSchoolStructure: "true",
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== "") fd.set(key, value);
  }
  return fd;
}

/** The single upsert the save performs, or a failure if it never ran. */
function upsertArgs(): UpsertArgs {
  if (profileUpsert.length !== 1) {
    throw new Error(`expected exactly one profile upsert, saw ${profileUpsert.length}`);
  }
  return profileUpsert[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  profileUpsert = [];
  userUpdate = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveSchoolHeadProfile — contact email", () => {
  it("persists the submitted address on both create and update", async () => {
    await expect(saveSchoolHeadProfile(buildFormData())).resolves.toEqual({ ok: true });

    const args = upsertArgs();
    expect(args.where).toEqual({ userId: HEAD_ID });
    expect(args.create.contactEmail).toBe("head@school.deped.gov.ph");
    expect(args.update.contactEmail).toBe("head@school.deped.gov.ph");
  });

  it("lower-cases and trims it, so a case variant is not stored as typed", async () => {
    await saveSchoolHeadProfile(buildFormData({ contactEmail: "  Head@School.DepEd.Gov.PH  " }));
    expect(upsertArgs().update.contactEmail).toBe("head@school.deped.gov.ph");
  });

  // The bug this guards: `undefined` in a Prisma `update` means "don't touch
  // this column". Clearing the field would have left the old address in place.
  it.each([
    ["a blank field", ""],
    ["a whitespace-only field", "   "],
  ])("writes an explicit null for %s, so clearing it actually clears it", async (_name, value) => {
    await expect(
      saveSchoolHeadProfile(buildFormData({ contactEmail: value }))
    ).resolves.toEqual({ ok: true });

    const args = upsertArgs();
    expect(args.update.contactEmail).toBeNull();
    expect(args.create.contactEmail).toBeNull();
    expect(args.update.contactEmail).not.toBeUndefined();
  });

  it("rejects a malformed address before touching the database", async () => {
    const result = await saveSchoolHeadProfile(buildFormData({ contactEmail: "not-an-email" }));
    expect(result.ok).toBe(false);
    expect(profileUpsert).toHaveLength(0);
    expect(userUpdate).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  // The survey address and the Supabase login identity are different things —
  // School Heads sign in with school + password against a synthetic address.
  it("never writes the contact address onto the login identity", async () => {
    await saveSchoolHeadProfile(buildFormData());

    expect(userUpdate).toHaveLength(1);
    const update = userUpdate[0] as { data: Record<string, unknown> };
    expect(update.data).not.toHaveProperty("email");
    expect(update.data.profileCompleted).toBe(true);
  });

  it("keeps the address out of the audit metadata", async () => {
    await saveSchoolHeadProfile(buildFormData());

    const [audit] = writeAudit.mock.calls[0] as unknown as [
      { metadata: Record<string, unknown> },
    ];
    expect(JSON.stringify(audit.metadata)).not.toContain("head@school.deped.gov.ph");
  });
});

describe("saveSchoolHeadProfile — position", () => {
  it("persists the selected Principal rank rather than a fixed default", async () => {
    await saveSchoolHeadProfile(buildFormData({ position: "PRINCIPAL_III" }));
    expect(upsertArgs().update.position).toBe("PRINCIPAL_III");
  });

  // A small school led by a Head Teacher or Teacher-in-Charge is why the second
  // group in the picker exists; the action has to accept what it offers.
  it.each(["PRINCIPAL_I", "PRINCIPAL_IV", "HEAD_TEACHER_III", "TEACHER_II_TIC", "TECHVOC_AD"])(
    "accepts %s",
    async (position) => {
      await expect(saveSchoolHeadProfile(buildFormData({ position }))).resolves.toEqual({
        ok: true,
      });
      expect(upsertArgs().create.position).toBe(position);
    }
  );

  it("rejects a rank that is not a school head position", async () => {
    const result = await saveSchoolHeadProfile(buildFormData({ position: "MASTER_TEACHER_I" }));
    expect(result.ok).toBe(false);
    expect(profileUpsert).toHaveLength(0);
  });

  it("rejects a missing position instead of silently defaulting it", async () => {
    const result = await saveSchoolHeadProfile(buildFormData({ position: "" }));
    expect(result.ok).toBe(false);
    expect(profileUpsert).toHaveLength(0);
  });
});
