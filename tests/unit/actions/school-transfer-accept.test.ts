import { beforeEach, describe, expect, it, vi } from "vitest";

/** Accepting cross-school transfers: partial batches, placement, audit. */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ transfers: [] as Row[], sections: [] as Row[] }));
const moves = vi.hoisted(() => ({
  learner: vi.fn(async () => {}),
  staff: vi.fn(async () => ({ clearedSections: 0, retutored: 0, untutored: 0 })),
}));
const audit = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => {
  const schoolTransferRequest = {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; toSchoolId: string } }) =>
      db.transfers.filter((t) => where.id.in.includes(t.id as string) && t.toSchoolId === where.toSchoolId)
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = db.transfers.filter((t) => t.id === where.id && t.status === where.status);
      for (const t of hit) Object.assign(t, data);
      return { count: hit.length };
    }),
  };
  return {
    prisma: {
      schoolTransferRequest,
      section: {
        findFirst: vi.fn(async ({ where }: { where: Row }) =>
          db.sections.find((s) => s.id === where.id && s.schoolId === where.schoolId) ?? null
        ),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ schoolTransferRequest })),
    },
  };
});
vi.mock("@/lib/transfers/actor", () => ({
  resolveTransferActor: vi.fn(async (schoolId: string) => ({ user: { id: "sh-b" }, schoolId, viaAdmin: false })),
}));
vi.mock("@/lib/transfers/apply-learner-move", () => ({ applyLearnerSchoolMove: moves.learner }));
vi.mock("@/lib/transfers/apply-staff-move", () => ({ applyStaffSchoolMove: moves.staff }));
vi.mock("@/lib/audit", () => ({
  writeAuditMany: audit,
  AUDIT_ACTIONS: { STAFF_SCHOOL_TRANSFER_ACCEPTED: "STAFF_SCHOOL_TRANSFER_ACCEPTED" },
}));
vi.mock("@/lib/school-year/gate", () => ({ assertSchoolYearOpen: vi.fn(async () => ({ open: true })) }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolTransfers: vi.fn(),
  revalidateLearnerScoped: vi.fn(),
  revalidateTeacherCaches: vi.fn(),
}));
vi.mock("@/lib/transfers/notify", () => ({ notifySchoolTransfer: vi.fn(async () => {}) }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(async () => undefined) }));

import { acceptSchoolTransfers } from "@/lib/actions/school-transfer";

const later = () => new Date(Date.now() + 86_400_000);
const learnerRow = (id: string, over: Row = {}) => ({
  id,
  kind: "LEARNER",
  status: "PENDING",
  expiresAt: later(),
  schoolId: "a",
  toSchoolId: "b",
  learnerId: `l-${id}`,
  userId: null,
  learner: { schoolId: "a", deletedAt: null, archivedAt: null },
  user: null,
  ...over,
});
const placement = { gradeLevelId: "g4", sectionId: "sec" };

beforeEach(() => {
  db.transfers = [];
  db.sections = [
    { id: "sec", schoolId: "b", gradeLevelId: "g4", adviser: { id: "adv", isActive: true, deletedAt: null } },
    { id: "sec-empty", schoolId: "b", gradeLevelId: "g4", adviser: null },
  ];
  moves.learner.mockClear();
  moves.staff.mockClear();
  audit.mockClear();
});

describe("acceptSchoolTransfers", () => {
  it("accepts the rows it can and skips a learner who moved schools", async () => {
    db.transfers = [
      learnerRow("1"),
      learnerRow("2"),
      learnerRow("3", { learner: { schoolId: "z", deletedAt: null, archivedAt: null } }),
    ];
    const res = await acceptSchoolTransfers({ schoolId: "b", ids: ["1", "2", "3"], placement });
    expect(res).toMatchObject({ ok: true, data: { accepted: 2, skipped: [{ id: "3", reason: "MOVED" }] } });
    expect(moves.learner).toHaveBeenCalledTimes(2);
    expect(db.transfers[2].status).toBe("PENDING");
  });

  it("skips an expired and an archived learner", async () => {
    db.transfers = [
      learnerRow("1", { expiresAt: new Date(Date.now() - 1) }),
      learnerRow("2", { learner: { schoolId: "a", deletedAt: null, archivedAt: new Date() } }),
    ];
    const res = await acceptSchoolTransfers({ schoolId: "b", ids: ["1", "2"], placement });
    expect(res).toMatchObject({
      ok: true,
      data: { accepted: 0, skipped: [{ reason: "EXPIRED" }, { reason: "REMOVED" }] },
    });
  });

  it("requires a placement for learners", async () => {
    db.transfers = [learnerRow("1")];
    const res = await acceptSchoolTransfers({ schoolId: "b", ids: ["1"] });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect((res as { fieldErrors?: Row }).fieldErrors).toHaveProperty("placement");
  });

  it("places the learner with the section's adviser, or none", async () => {
    db.transfers = [learnerRow("1")];
    await acceptSchoolTransfers({ schoolId: "b", ids: ["1"], placement });
    expect(moves.learner).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ teacherId: "adv" }));

    db.transfers = [learnerRow("2")];
    await acceptSchoolTransfers({ schoolId: "b", ids: ["2"], placement: { gradeLevelId: "g4", sectionId: "sec-empty" } });
    expect(moves.learner).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ teacherId: null }));
  });

  it("moves a teacher and writes a security audit row", async () => {
    db.transfers = [
      {
        ...learnerRow("t"),
        kind: "TEACHER",
        learnerId: null,
        userId: "t1",
        learner: null,
        user: { schoolId: "a", deletedAt: null, isActive: true },
      },
    ];
    const res = await acceptSchoolTransfers({ schoolId: "b", ids: ["t"] });
    expect(res).toMatchObject({ ok: true, data: { accepted: 1 } });
    expect(moves.staff).toHaveBeenCalledWith(expect.anything(), { userId: "t1", fromSchoolId: "a", toSchoolId: "b" });
    expect(audit).toHaveBeenCalledWith([
      expect.objectContaining({ action: "STAFF_SCHOOL_TRANSFER_ACCEPTED", resourceId: "t1" }),
    ]);
  });
});
