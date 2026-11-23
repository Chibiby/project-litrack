import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sending, cancelling and declining cross-school transfers
 * (docs/superpowers/specs/2026-11-23-cross-school-transfers-design.md).
 * Prisma is an in-memory fake that applies the `where` it is given, so a
 * dropped tenant or status filter shows up as a wrong result.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  schools: [] as Row[],
  learners: [] as Row[],
  users: [] as Row[],
  transfers: [] as Row[],
}));
const notify = vi.hoisted(() => vi.fn(async () => {}));

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("gt" in c) return (value as Date).getTime() > (c.gt as Date).getTime();
      if ("lte" in c) return (value as Date).getTime() <= (c.lte as Date).getTime();
      return true;
    }
    return value === cond;
  });
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findMany: vi.fn(async ({ where }: { where: Row }) => db.schools.filter((s) => matches(s, { id: where.id }))) },
    learner: { findMany: vi.fn(async ({ where }: { where: Row }) => db.learners.filter((l) => matches(l, where))) },
    user: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.users.filter((u) => matches(u, where)).map((u) => ({ id: u.id, teacherProfile: { designation: u.designation } }))
      ),
    },
    schoolTransferRequest: {
      findMany: vi.fn(async ({ where }: { where: Row }) => db.transfers.filter((t) => matches(t, where))),
      count: vi.fn(async ({ where }: { where: Row }) => db.transfers.filter((t) => matches(t, where)).length),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        for (const d of data) db.transfers.push({ id: `t-${db.transfers.length}`, status: "PENDING", ...d });
        return { count: data.length };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = db.transfers.filter((t) => matches(t, where));
        for (const t of hit) Object.assign(t, data);
        return { count: hit.length };
      }),
    },
  },
}));
vi.mock("@/lib/transfers/actor", () => ({
  resolveTransferActor: vi.fn(async (schoolId: string) => ({ user: { id: "sh-a" }, schoolId, viaAdmin: false })),
}));
vi.mock("@/lib/school-year/gate", () => ({ assertSchoolYearOpen: vi.fn(async () => ({ open: true })) }));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateSchoolTransfers: vi.fn() }));
vi.mock("@/lib/transfers/notify", () => ({ notifySchoolTransfer: notify }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(async () => undefined) }));

import {
  cancelSchoolTransfers,
  declineSchoolTransfers,
  requestSchoolTransfers,
} from "@/lib/actions/school-transfer";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  db.schools = [
    { id: "a", division: "Division of X", isActive: true },
    { id: "b", division: "division of x", isActive: true },
    { id: "y", division: "Division of Y", isActive: true },
  ];
  db.learners = ["l1", "l2", "l3"].map((id) => ({ id, schoolId: "a", deletedAt: null, archivedAt: null }));
  db.learners.push({ id: "lb", schoolId: "b", deletedAt: null, archivedAt: null });
  db.users = [
    { id: "vol", schoolId: "a", role: "TEACHER", deletedAt: null, isActive: true, approvalStatus: "APPROVED", designation: ARAL_VOLUNTEER_DESIGNATION },
  ];
  db.transfers = [];
  notify.mockClear();
});

const send = (over: Row = {}) =>
  requestSchoolTransfers({ schoolId: "a", toSchoolId: "b", kind: "LEARNER", ids: ["l1"], ...over });

describe("requestSchoolTransfers", () => {
  it("refuses a school in another division", async () => {
    const res = await send({ toSchoolId: "y" });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect((res as { fieldErrors?: Row }).fieldErrors).toHaveProperty("toSchoolId");
  });

  it("refuses a learner of another school as NOT_FOUND", async () => {
    expect(await send({ ids: ["lb"] })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("refuses a learner who already has a pending transfer", async () => {
    db.transfers.push({ id: "old", learnerId: "l1", status: "PENDING", expiresAt: new Date(Date.now() + DAY) });
    expect(await send()).toMatchObject({ ok: false, code: "TRANSFER_REQUEST_PENDING" });
  });

  it("lets an expired pending transfer be replaced", async () => {
    db.transfers.push({ id: "old", learnerId: "l1", status: "PENDING", expiresAt: new Date(Date.now() - 1) });
    expect(await send()).toMatchObject({ ok: true });
    expect(db.transfers.find((t) => t.id === "old")?.status).toBe("EXPIRED");
  });

  it("refuses a volunteer sent from the Teachers tab", async () => {
    const res = await send({ kind: "TEACHER", ids: ["vol"] });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  it("creates one row per learner, sharing a batch, expiring in 30 days", async () => {
    const before = Date.now();
    const res = await send({ ids: ["l1", "l2", "l3"] });
    expect(res).toMatchObject({ ok: true, data: { count: 3 } });
    const batches = new Set(db.transfers.map((t) => t.batchId));
    expect(db.transfers).toHaveLength(3);
    expect(batches.size).toBe(1);
    for (const t of db.transfers) {
      expect(t).toMatchObject({ schoolId: "a", toSchoolId: "b", kind: "LEARNER", userId: null, requestedById: "sh-a" });
      const days = ((t.expiresAt as Date).getTime() - before) / DAY;
      expect(days).toBeGreaterThan(29.99);
      expect(days).toBeLessThan(30.01);
    }
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "REQUESTED" }));
  });
});

describe("cancelSchoolTransfers and declineSchoolTransfers", () => {
  beforeEach(() => {
    db.transfers = [
      { id: "p1", schoolId: "a", toSchoolId: "b", status: "PENDING", expiresAt: new Date(Date.now() + DAY) },
      { id: "x1", schoolId: "a", toSchoolId: "b", status: "PENDING", expiresAt: new Date(Date.now() - 1) },
    ];
  });

  it("cancels only the sender's own pending rows", async () => {
    expect(await cancelSchoolTransfers({ schoolId: "b", ids: ["p1"] })).toMatchObject({ ok: false });
    expect(await cancelSchoolTransfers({ schoolId: "a", ids: ["p1"] })).toMatchObject({ ok: true, data: { count: 1 } });
    expect(db.transfers[0].status).toBe("CANCELLED");
  });

  it("refuses to decline an expired row", async () => {
    expect(await declineSchoolTransfers({ schoolId: "b", ids: ["x1"] })).toMatchObject({
      ok: false,
      code: "TRANSFER_REQUESTS_CHANGED",
    });
  });

  it("declines with the note and notifies the sender", async () => {
    const res = await declineSchoolTransfers({ schoolId: "b", ids: ["p1"], note: "No room in Grade 4" });
    expect(res).toMatchObject({ ok: true, data: { count: 1 } });
    expect(db.transfers[0]).toMatchObject({ status: "DECLINED", decisionNote: "No room in Grade 4" });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "DECIDED", ids: ["p1"] }));
  });
});
