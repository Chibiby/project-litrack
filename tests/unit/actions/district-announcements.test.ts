import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Broadcasts fanned out to many schools by a district admin (their own
 * districts) or the division office (any school) —
 * `docs/specs/district-admin.md` 3.5, invariants I6, I7, I13.
 *
 * Three properties, each proven to fail if its guard is removed:
 *
 * - **Any out-of-scope id in the target fails the WHOLE call.** No partial
 *   fan-out to the schools that were in scope.
 * - **Retract only ever touches rows in the caller's own scope**, even for a
 *   broadcastId that also reached schools outside it.
 * - **A School Head cannot edit or delete a broadcast row** — `broadcastId`
 *   is what marks it read-only to them (I13), proven here for
 *   `src/lib/actions/announcement.ts` as well as this module.
 *
 * `@/lib/auth/admin-scope` is deliberately NOT mocked (pure, no Prisma, no
 * `server-only`) — the point is to prove the real `schoolWhereForScope` and
 * `resolveSummaryScope` output reaches every Prisma call in this module.
 */

const schoolFindMany = vi.fn();
const announcementCreateMany = vi.fn();
const announcementFindMany = vi.fn();
const announcementUpdateMany = vi.fn();
const announcementFindFirst = vi.fn();
const announcementUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findMany() {
        return schoolFindMany;
      },
    },
    announcement: {
      get createMany() {
        return announcementCreateMany;
      },
      get findMany() {
        return announcementFindMany;
      },
      get updateMany() {
        return announcementUpdateMany;
      },
      get findFirst() {
        return announcementFindFirst;
      },
      get update() {
        return announcementUpdate;
      },
    },
  },
}));

const requireAdminScope = vi.fn();
const loadSchoolInScope = vi.fn();
vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: () => requireAdminScope(),
  loadSchoolInScope: (...a: unknown[]) => loadSchoolInScope(...a),
}));

const requireSchoolUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...a: unknown[]) => requireSchoolUser(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...a),
  AUDIT_ACTIONS: {
    ANNOUNCEMENT_BROADCAST: "ANNOUNCEMENT_BROADCAST",
    ANNOUNCEMENT_BROADCAST_RETRACT: "ANNOUNCEMENT_BROADCAST_RETRACT",
    ANNOUNCEMENT_UPDATE: "ANNOUNCEMENT_UPDATE",
    ANNOUNCEMENT_DELETE: "ANNOUNCEMENT_DELETE",
  },
}));

const revalidateSchoolDashboard = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: (...a: unknown[]) => revalidateSchoolDashboard(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const reportError = vi.fn(() => "E-TESTREF");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

const { broadcastAnnouncement, retractBroadcast, listMyBroadcasts } = await import(
  "@/lib/actions/district-announcements"
);
const { updateAnnouncement, deleteAnnouncement } = await import(
  "@/lib/actions/announcement"
);
const { schoolWhereForScope } = await import("@/lib/auth/admin-scope");
const { resourceNotFound } = await import("@/lib/errors/app-error");

const DA = { id: "da-1", schoolId: null, role: "DISTRICT_ADMIN" };
const SA = { id: "sa-1", schoolId: null, role: "SUPER_ADMIN" };
const DIVISION_SCOPE = { kind: "division" as const };
const DISTRICT_SCOPE = { kind: "districts" as const, districts: ["Alabel 1"] };

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const SCHOOL_OUTSIDE = "99999999-9999-4999-8999-999999999999";
const BROADCAST_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminScope.mockResolvedValue({ user: DA, scope: DISTRICT_SCOPE });
  requireSchoolUser.mockResolvedValue({ id: "head-1", schoolId: "school-1", role: "SCHOOL_HEAD" });
  loadSchoolInScope.mockImplementation(async (_scope: unknown, schoolId: string) => ({
    id: schoolId,
  }));
  schoolFindMany.mockResolvedValue([{ id: SCHOOL_A }, { id: SCHOOL_B }]);
  announcementCreateMany.mockResolvedValue({ count: 2 });
  announcementUpdateMany.mockResolvedValue({ count: 2 });
});

function target(kind: "all" | "district" | "schools", extra: Record<string, unknown> = {}) {
  if (kind === "all") return { kind: "all" as const };
  if (kind === "district") return { kind: "district" as const, district: "Alabel 1", ...extra };
  return { kind: "schools" as const, schoolIds: [SCHOOL_A, SCHOOL_B], ...extra };
}

describe("broadcastAnnouncement — target: schools", () => {
  it("fails the WHOLE call when one school id is out of scope, and writes nothing", async () => {
    loadSchoolInScope.mockImplementation(async (_scope: unknown, schoolId: string) => {
      if (schoolId === SCHOOL_OUTSIDE) {
        throw resourceNotFound("School", { crossTenant: true });
      }
      return { id: schoolId };
    });

    const result = await broadcastAnnouncement({
      title: "Division memo",
      body: "Please submit your reports by Friday.",
      target: target("schools", { schoolIds: [SCHOOL_A, SCHOOL_OUTSIDE] }),
    });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(announcementCreateMany).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("checks every named school against the caller's scope", async () => {
    await broadcastAnnouncement({
      title: "Division memo",
      body: "Please submit your reports by Friday.",
      target: target("schools"),
    });

    expect(loadSchoolInScope).toHaveBeenCalledWith(DISTRICT_SCOPE, SCHOOL_A, { id: true });
    expect(loadSchoolInScope).toHaveBeenCalledWith(DISTRICT_SCOPE, SCHOOL_B, { id: true });
  });

  it("writes one row per school, all sharing one broadcastId", async () => {
    await broadcastAnnouncement({
      title: "Division memo",
      body: "Please submit your reports by Friday.",
      target: target("schools"),
    });

    const rows = announcementCreateMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.schoolId).sort()).toEqual([SCHOOL_A, SCHOOL_B].sort());
    const broadcastIds = new Set(rows.map((r) => r.broadcastId));
    expect(broadcastIds.size).toBe(1);
    for (const row of rows) {
      expect(row).toMatchObject({
        authorId: "da-1",
        title: "Division memo",
        body: "Please submit your reports by Friday.",
      });
    }
  });

  it("revalidates every targeted school's dashboard", async () => {
    await broadcastAnnouncement({
      title: "T",
      body: "B",
      target: target("schools"),
    });

    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_A);
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_B);
  });

  it("audits with the broadcastId and a school count, never a school name", async () => {
    const result = await broadcastAnnouncement({
      title: "T",
      body: "B",
      target: target("schools"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({
      userId: "da-1",
      action: "ANNOUNCEMENT_BROADCAST",
      resource: "Announcement",
      resourceId: result.data.broadcastId,
      metadata: { broadcastId: result.data.broadcastId, schoolCount: 2 },
    });
  });
});

describe("broadcastAnnouncement — target: district", () => {
  it("refuses a district outside a district admin's own assignments", async () => {
    const result = await broadcastAnnouncement({
      title: "T",
      body: "B",
      target: target("district", { district: "Glan 1" }),
    });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(announcementCreateMany).not.toHaveBeenCalled();
  });

  it("resolves to every school in that one district, scoped", async () => {
    await broadcastAnnouncement({
      title: "T",
      body: "B",
      target: target("district"),
    });

    expect(schoolFindMany.mock.calls[0]?.[0]?.where).toEqual(
      schoolWhereForScope({ kind: "districts", districts: ["Alabel 1"] })
    );
  });

  it("lets a Super Admin name any district", async () => {
    requireAdminScope.mockResolvedValue({ user: SA, scope: DIVISION_SCOPE });

    const result = await broadcastAnnouncement({
      title: "T",
      body: "B",
      target: target("district", { district: "Glan 1" }),
    });

    expect(result.ok).toBe(true);
  });
});

describe("broadcastAnnouncement — target: all", () => {
  it("resolves to every school in the caller's own scope", async () => {
    await broadcastAnnouncement({ title: "T", body: "B", target: target("all") });

    expect(schoolFindMany.mock.calls[0]?.[0]?.where).toEqual(schoolWhereForScope(DISTRICT_SCOPE));
  });

  it("fails rather than broadcasting to zero schools", async () => {
    schoolFindMany.mockResolvedValue([]);

    const result = await broadcastAnnouncement({ title: "T", body: "B", target: target("all") });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(announcementCreateMany).not.toHaveBeenCalled();
  });
});

describe("retractBroadcast", () => {
  it("loads rows WITH the caller's scope in the where", async () => {
    announcementFindMany.mockResolvedValue([{ id: "row-1", schoolId: SCHOOL_A }]);

    await retractBroadcast({ broadcastId: BROADCAST_ID });

    expect(announcementFindMany.mock.calls[0]?.[0]?.where).toEqual({
      broadcastId: BROADCAST_ID,
      deletedAt: null,
      school: schoolWhereForScope(DISTRICT_SCOPE),
    });
  });

  it("gives NOT_FOUND when no row in scope carries that broadcastId", async () => {
    announcementFindMany.mockResolvedValue([]);

    const result = await retractBroadcast({ broadcastId: BROADCAST_ID });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(announcementUpdateMany).not.toHaveBeenCalled();
  });

  it("soft-deletes only the in-scope rows, and revalidates each of their schools", async () => {
    announcementFindMany.mockResolvedValue([
      { id: "row-1", schoolId: SCHOOL_A },
      { id: "row-2", schoolId: SCHOOL_B },
    ]);

    const result = await retractBroadcast({ broadcastId: BROADCAST_ID });

    expect(result).toMatchObject({ ok: true, data: { schoolCount: 2 } });
    expect(announcementUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: { in: ["row-1", "row-2"] } },
    });
    expect(announcementUpdateMany.mock.calls[0]?.[0]?.data?.deletedAt).toBeInstanceOf(Date);
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_A);
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_B);
    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({
      action: "ANNOUNCEMENT_BROADCAST_RETRACT",
      metadata: { broadcastId: BROADCAST_ID, schoolCount: 2 },
    });
  });
});

describe("listMyBroadcasts", () => {
  it("scopes to the caller's own authored rows within their own scope", async () => {
    announcementFindMany.mockResolvedValue([
      {
        broadcastId: BROADCAST_ID,
        title: "T",
        body: "B",
        publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      {
        broadcastId: BROADCAST_ID,
        title: "T",
        body: "B",
        publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ]);

    const rows = await listMyBroadcasts();

    expect(announcementFindMany.mock.calls[0]?.[0]?.where).toEqual({
      broadcastId: { not: null },
      deletedAt: null,
      authorId: "da-1",
      school: schoolWhereForScope(DISTRICT_SCOPE),
    });
    expect(rows).toEqual([
      {
        broadcastId: BROADCAST_ID,
        title: "T",
        body: "B",
        publishedAt: new Date("2026-09-01T00:00:00.000Z"),
        schoolCount: 2,
      },
    ]);
  });
});

describe("I13 — a School Head cannot edit or delete a broadcast", () => {
  it("updateAnnouncement refuses a row with broadcastId set", async () => {
    // The where itself is the guard: a real Prisma query with `broadcastId: null`
    // simply never matches a broadcast row, so the mock returning null here
    // stands in for that — the same "reads as missing" NOT_FOUND every other
    // tenant boundary in this app gives.
    announcementFindFirst.mockResolvedValue(null);

    const fd = new FormData();
    fd.set("announcementId", "row-1");
    fd.set("title", "New title");
    fd.set("body", "New body");
    const result = await updateAnnouncement(fd);

    expect(announcementFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      id: "row-1",
      schoolId: "school-1",
      deletedAt: null,
      broadcastId: null,
    });
    expect(result).toEqual({ ok: false, error: "Announcement not found" });
    expect(announcementUpdate).not.toHaveBeenCalled();
  });

  it("deleteAnnouncement refuses a row with broadcastId set", async () => {
    announcementFindFirst.mockResolvedValue(null);

    const fd = new FormData();
    fd.set("announcementId", "row-1");
    const result = await deleteAnnouncement(fd);

    expect(announcementFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      id: "row-1",
      schoolId: "school-1",
      deletedAt: null,
      broadcastId: null,
    });
    expect(result).toEqual({ ok: false, error: "Announcement not found" });
  });
});
