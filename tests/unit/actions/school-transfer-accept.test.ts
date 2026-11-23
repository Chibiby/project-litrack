import { beforeEach, describe, expect, it, vi } from "vitest";

/** Accepting cross-school transfers: partial batches, placement, audit, scale. */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ transfers: [] as Row[], sections: [] as Row[] }));
const moves = vi.hoisted(() => ({
  learners: vi.fn(async (_tx: unknown, p: { learnerIds: string[] }) => ({ moved: p.learnerIds.length })),
  staff: vi.fn(async () => ({ clearedSections: 0, retutored: 0, untutored: 0 })),
}));
const audit = vi.hoisted(() => vi.fn(async () => {}));
const txSpy = vi.hoisted(() => ({ options: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => {
  const matches = (t: Row, where: Row) => {
    const id = where.id as string | { in: string[] };
    return (typeof id === "string" ? t.id === id : id.in.includes(t.id as string)) && t.status === where.status;
  };
  const schoolTransferRequest = {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; toSchoolId: string } }) =>
      db.transfers.filter((t) => where.id.in.includes(t.id as string) && t.toSchoolId === where.toSchoolId)
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = db.transfers.filter((t) => matches(t, where));
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
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => {
        txSpy.options = options;
        const snapshot = db.transfers.map((t) => ({ ...t }));
        try {
          return await fn({ schoolTransferRequest });
        } catch (err) {
          db.transfers = snapshot; // roll back like Postgres
          throw err;
        }
      }),
    },
  };
});
vi.mock("@/lib/transfers/actor", () => ({
  resolveTransferActor: vi.fn(async (schoolId: string) => ({ user: { id: "sh-b" }, schoolId, viaAdmin: false })),
}));
vi.mock("@/lib/transfers/apply-learner-move", () => ({ applyLearnerSchoolMoves: moves.learners }));
vi.mock("@/lib/transfers/apply-staff-move", () => ({ applyStaffSchoolMove: moves.staff }));
vi.mock("@/lib/audit", () => ({
  writeAuditMany: audit,
  AUDIT_ACTIONS: {
    STAFF_SCHOOL_TRANSFER_ACCEPTED: "STAFF_SCHOOL_TRANSFER_ACCEPTED",
    LEARNER_TRANSFER_CROSS_SCHOOL: "LEARNER_TRANSFER_CROSS_SCHOOL",
  },
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
const teacherRow = (id: string) => ({
  ...learnerRow(id),
  kind: "TEACHER",
  learnerId: null,
  userId: `u-${id}`,
  learner: null,
  user: { schoolId: "a", deletedAt: null, isActive: true },
});
const placement = { gradeLevelId: "g4", sectionId: "sec" };

beforeEach(() => {
  db.transfers = [];
  db.sections = [
    { id: "sec", schoolId: "b", gradeLevelId: "g4", adviser: { id: "adv", isActive: true, deletedAt: null } },
    { id: "sec-empty", schoolId: "b", gradeLevelId: "g4", adviser: null },
  ];
  moves.learners.mockClear();
  moves.staff.mockClear();
  audit.mockClear();
  txSpy.options = undefined;
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
    expect(moves.learners).toHaveBeenCalledTimes(1);
    expect(moves.learners).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ learnerIds: ["l-1", "l-2"] }));
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
    expect(moves.learners).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ teacherId: "adv" }));

    db.transfers = [learnerRow("2")];
    await acceptSchoolTransfers({ schoolId: "b", ids: ["2"], placement: { gradeLevelId: "g4", sectionId: "sec-empty" } });
    expect(moves.learners).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ teacherId: null }));
  });

  it("accepts a large batch with one bulk move per sending school, on the long transaction budget", async () => {
    db.transfers = [
      ...Array.from({ length: 30 }, (_, i) => learnerRow(`a${i}`)),
      ...Array.from({ length: 10 }, (_, i) => learnerRow(`c${i}`, { schoolId: "c", learner: { schoolId: "c", deletedAt: null, archivedAt: null } })),
    ];
    const res = await acceptSchoolTransfers({ schoolId: "b", ids: db.transfers.map((t) => t.id), placement });

    expect(res).toMatchObject({ ok: true, data: { accepted: 40 } });
    expect(moves.learners).toHaveBeenCalledTimes(2);
    expect(moves.learners).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fromSchoolId: "a" }));
    expect(moves.learners).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fromSchoolId: "c" }));
    expect(txSpy.options).toMatchObject({ timeout: 30_000 });
  });

  it("refuses the whole batch when a learner was archived or moved during the accept", async () => {
    db.transfers = [learnerRow("1"), learnerRow("2")];
    moves.learners.mockImplementationOnce(async () => ({ moved: 1 }));

    const res = await acceptSchoolTransfers({ schoolId: "b", ids: ["1", "2"], placement });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUESTS_CHANGED" });
    expect(db.transfers.map((t) => t.status)).toEqual(["PENDING", "PENDING"]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("writes a cross-school security audit row for every accepted learner", async () => {
    db.transfers = [learnerRow("1"), learnerRow("2")];
    await acceptSchoolTransfers({ schoolId: "b", ids: ["1", "2"], placement });

    expect(audit).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "LEARNER_TRANSFER_CROSS_SCHOOL",
          resource: "Learner",
          resourceId: "l-1",
          metadata: expect.objectContaining({ fromSchoolId: "a", toSchoolId: "b", transferId: "1" }),
        }),
        expect.objectContaining({ action: "LEARNER_TRANSFER_CROSS_SCHOOL", resourceId: "l-2" }),
      ])
    );
  });

  it("moves a teacher and writes a security audit row", async () => {
    db.transfers = [teacherRow("t")];
    const res = await acceptSchoolTransfers({ schoolId: "b", ids: ["t"] });
    expect(res).toMatchObject({ ok: true, data: { accepted: 1 } });
    expect(moves.staff).toHaveBeenCalledWith(expect.anything(), { userId: "u-t", fromSchoolId: "a", toSchoolId: "b" });
    expect(audit).toHaveBeenCalledWith([
      expect.objectContaining({ action: "STAFF_SCHOOL_TRANSFER_ACCEPTED", resourceId: "u-t" }),
    ]);
  });

  it("accepts at most 10 teachers and ARAL volunteers at a time", async () => {
    db.transfers = Array.from({ length: 11 }, (_, i) => teacherRow(`t${i}`));
    const res = await acceptSchoolTransfers({ schoolId: "b", ids: db.transfers.map((t) => t.id) });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(moves.staff).not.toHaveBeenCalled();
    expect(db.transfers.every((t) => t.status === "PENDING")).toBe(true);
  });
});
