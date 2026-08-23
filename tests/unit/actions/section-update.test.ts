import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Action-level coverage for `updateSection` — the School Head renaming a section.
 *
 * The behaviour pinned here is the `schoolTeachers` bust, because a rename is the
 * one `Section` write that changes a *cached* value while touching no `User` row.
 * `listAralTutors` is tagged `schoolTeachers(schoolId)` and builds each teacher's
 * `advisoryLabel` from `advisorySection.name`, so without
 * `revalidateSchoolTeachers` every ARAL tutor picker keeps showing the old section
 * name until the entry's TTL runs out. Nothing about that is visible from the
 * rename's own response — the action returns `{ ok: true }` either way, and the
 * Grade Levels page it revalidates shows the new name immediately — which is
 * exactly why it needs a test rather than a manual check.
 *
 * Sibling to `section-delete.test.ts`, and the same two conventions apply: the
 * `section.findFirst` fake honours `schoolId` and `deletedAt` instead of returning
 * rows regardless, and the assertions land on the mocked `@/lib/cache/revalidate`
 * helpers so tag-string format stays owned by `src/lib/cache/revalidate.ts`.
 *
 * The real `updateSectionSchema` runs — a mocked schema is how a fixture typo
 * becomes a green test.
 */

const HEAD_ID = "head-1";
const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";
const SECTION_ID = "section-1";
const GRADE_ID = "grade-g3";

type SectionRow = {
  id: string;
  name: string;
  gradeLevelId: string;
  schoolId: string;
  deletedAt: Date | null;
};

let sectionRows: SectionRow[];

/**
 * Honours `schoolId` and `deletedAt`, so the cross-tenant refusal below is a real
 * miss rather than a fixture that happened to be absent.
 */
const sectionFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId: string } }) => {
    const found = sectionRows.find(
      (s) =>
        s.id === args.where.id &&
        s.schoolId === args.where.schoolId &&
        s.deletedAt === null
    );
    return found ? { ...found } : null;
  }
);

/** Really renames the row, so "the write happened" is not taken on trust. */
const sectionUpdate = vi.fn(
  async (args: { where: { id: string }; data: { name: string } }) => {
    const row = sectionRows.find((s) => s.id === args.where.id);
    if (row) row.name = args.data.name;
    return row ?? {};
  }
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    section: {
      findFirst: (...args: unknown[]) => sectionFindFirst(...(args as [never])),
      update: (...args: unknown[]) => sectionUpdate(...(args as [never])),
    },
  },
}));

const requireSchoolUser = vi.fn(async () => ({ id: HEAD_ID, schoolId: SCHOOL_ID }));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const writeAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [])),
  AUDIT_ACTIONS: { SECTION_UPDATE: "SECTION_UPDATE" },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [])),
}));

// Only the two helpers `updateSection` reaches. `deleteSection`'s
// `revalidateSchoolHeadTeachers` and `revalidateTeacherCaches` are deliberately
// absent: this file does not exercise that action, and a factory that supplied
// them would suggest otherwise.
const revalidateSchoolDashboard = vi.fn();
const revalidateSchoolTeachers = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: (...args: unknown[]) =>
    revalidateSchoolDashboard(...(args as [])),
  revalidateSchoolTeachers: (...args: unknown[]) =>
    revalidateSchoolTeachers(...(args as [])),
}));

// Imported after the mock factories above are registered.
const { updateSection } = await import("@/lib/actions/section");

function buildFormData(sectionId: string, name: string): FormData {
  const fd = new FormData();
  fd.set("sectionId", sectionId);
  fd.set("name", name);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  sectionRows = [
    {
      id: SECTION_ID,
      name: "Sampaguita",
      gradeLevelId: GRADE_ID,
      schoolId: SCHOOL_ID,
      deletedAt: null,
    },
  ];
  requireSchoolUser.mockResolvedValue({ id: HEAD_ID, schoolId: SCHOOL_ID });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateSection — cache fan-out on a rename", () => {
  it("busts this school's cached teacher list, not just the dashboard", async () => {
    const result = await updateSection(buildFormData(SECTION_ID, "Rosal"));

    // Anti-vacuity gate, and it is not optional: a bailed-out action returns
    // before every assertion below, which would make them all pass on nothing.
    expect(result).toEqual({ ok: true });
    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    // The rename really landed, so this is the success path and not a no-op.
    expect(sectionUpdate).toHaveBeenCalledWith({
      where: { id: SECTION_ID },
      data: { name: "Rosal" },
    });
    expect(sectionRows[0].name).toBe("Rosal");

    // The case this file exists for. `listAralTutors` caches `advisoryLabel`,
    // which embeds the section name, under `schoolTeachers(schoolId)`; the
    // dashboard bust below does not reach that tag. Remove the
    // `revalidateSchoolTeachers` line from the action and only this reddens.
    expect(revalidateSchoolTeachers).toHaveBeenCalledWith(SCHOOL_ID);
    // With the id, not bare: the tag is tenant-scoped, so another school's id
    // would clear that tenant's tutor list and leave this one stale.
    expect(revalidateSchoolTeachers).toHaveBeenCalledTimes(1);

    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_ID);
    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HEAD_ID,
        schoolId: SCHOOL_ID,
        action: "SECTION_UPDATE",
        resource: "Section",
        resourceId: SECTION_ID,
      })
    );
  });

  it("renames nothing and busts nothing for a section in another school", async () => {
    sectionRows = sectionRows.map((s) => ({ ...s, schoolId: OTHER_SCHOOL_ID }));

    const result = await updateSection(buildFormData(SECTION_ID, "Rosal"));

    expect(result).toEqual({ ok: false, error: "Section not found" });
    expect(JSON.stringify(result)).not.toContain(OTHER_SCHOOL_ID);
    expect(sectionUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    // A bust on a refused rename would flush a tenant this School Head has no
    // business reaching, and would also make the case above pass unconditionally.
    expect(revalidateSchoolTeachers).not.toHaveBeenCalled();
    expect(revalidateSchoolDashboard).not.toHaveBeenCalled();
  });
});
