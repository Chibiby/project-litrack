import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

/**
 * `listAralTutorOptions` — the on-demand ARAL tutor picker's read action.
 *
 * The action takes no id from the caller at all: the school comes from the
 * session (`user.schoolId`), so there is nothing to craft to reach another
 * tenant's teacher list. The tenancy story is therefore not "a foreign id is
 * refused" but "the query is scoped by MY session's school, and only ever
 * that one" — asserted below by checking `listAralTutors`'s own argument for
 * two different signed-in schools, and by fixturing per-school data so a
 * result would visibly leak if the scoping were ever dropped.
 */

const requireSchoolUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...args),
}));

const listAralTutors = vi.fn();
vi.mock("@/lib/teachers/aral-tutor", () => ({
  listAralTutors: (...args: unknown[]) => listAralTutors(...(args as [string])),
}));

const { listAralTutorOptions } = await import("@/lib/actions/aral-tutors");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

const TUTORS_A = [
  { id: "teacher-a1", name: "Ana Cruz", advisoryLabel: "Grade 3 · Sampaguita", employmentType: "DEPED_PLANTILLA" as const },
];
const TUTORS_B = [
  { id: "teacher-b1", name: "Ben Reyes", advisoryLabel: null, employmentType: "NON_DEPED" as const },
];

beforeEach(() => {
  vi.clearAllMocks();
  listAralTutors.mockImplementation(async (schoolId: string) =>
    schoolId === SCHOOL_A ? TUTORS_A : schoolId === SCHOOL_B ? TUTORS_B : []
  );
});

describe("listAralTutorOptions — authorization", () => {
  it("refuses anyone requireSchoolUser refuses — no second, looser path in", async () => {
    requireSchoolUser.mockRejectedValue(
      new AppError("AUTH_FORBIDDEN", { params: { what: "this" } })
    );

    const res = await listAralTutorOptions();

    expect(res).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(listAralTutors).not.toHaveBeenCalled();
  });
});

describe("listAralTutorOptions — tenancy", () => {
  it("scopes the list to the caller's own school, never a foreign one", async () => {
    requireSchoolUser.mockResolvedValue({ id: "teacher-a1", role: "TEACHER", schoolId: SCHOOL_A });

    const res = await listAralTutorOptions();

    expect(res).toMatchObject({ ok: true, data: { tutors: TUTORS_A, selfId: "teacher-a1" } });
    expect(listAralTutors).toHaveBeenCalledTimes(1);
    expect(listAralTutors).toHaveBeenCalledWith(SCHOOL_A);
    expect(listAralTutors).not.toHaveBeenCalledWith(SCHOOL_B);
  });

  it("a different signed-in school gets that school's list, never the other one's", async () => {
    requireSchoolUser.mockResolvedValue({ id: "head-b", role: "SCHOOL_HEAD", schoolId: SCHOOL_B });

    const res = await listAralTutorOptions();

    expect(res).toMatchObject({ ok: true, data: { tutors: TUTORS_B, selfId: "head-b" } });
    if (!res.ok) throw new Error("expected ok");
    const ids = res.data.tutors.map((t) => t.id);
    expect(ids).not.toContain("teacher-a1");
  });
});

describe("listAralTutorOptions — happy path", () => {
  it("returns the tutor list and the caller's own id for the picker's 'Myself' option", async () => {
    requireSchoolUser.mockResolvedValue({ id: "teacher-a1", role: "TEACHER", schoolId: SCHOOL_A });

    const res = await listAralTutorOptions();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({ tutors: TUTORS_A, selfId: "teacher-a1" });
  });

  it("allows a School Head, not just a teacher", async () => {
    requireSchoolUser.mockResolvedValue({ id: "head-a", role: "SCHOOL_HEAD", schoolId: SCHOOL_A });

    const res = await listAralTutorOptions();

    expect(res).toMatchObject({ ok: true, data: { selfId: "head-a" } });
  });
});
