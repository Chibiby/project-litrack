import { beforeEach, describe, expect, it, vi } from "vitest";
import { resourceNotFound } from "@/lib/errors/app-error";

/**
 * Section transfer actions (docs/specs/learner-section-transfers.md §2e).
 *
 * Prisma is an in-memory fake that honours the `where` fields these actions
 * send (id/in, schoolId, status, deletedAt, archivedAt, sectionId/in,
 * requestedById), so a dropped tenancy filter shows up as a wrong result rather
 * than passing silently. `assertSameSchool` keeps its real behaviour.
 *
 * `applySectionTransferBatch` runs for real against the same fake, so the
 * compare-and-set and the Enrollment close/create are exercised end to end.
 */

const SCHOOL = "school-1";
const OTHER_SCHOOL = "school-2";
const HEAD = "head-1";
const TEACHER = "teacher-1";
const OTHER_TEACHER = "teacher-2";
const ADVISER_B = "adviser-b";
const GRADE = "grade-3";
const GRADE_4 = "grade-4";

type LearnerRow = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  sectionId: string | null;
  teacherId: string | null;
  aralTeacherId: string | null;
  deletedAt: Date | null;
  archivedAt: Date | null;
};
type SectionRow = {
  id: string;
  name: string;
  schoolId: string;
  gradeLevelId: string;
  deletedAt: Date | null;
  adviserId: string | null;
};
type RequestRow = {
  id: string;
  schoolId: string;
  learnerId: string;
  requestedById: string | null;
  fromSectionId: string;
  toSectionId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  reason: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
};
type EnrollmentRow = {
  id: string;
  learnerId: string;
  schoolId: string;
  schoolYearId: string;
  gradeLevelId: string;
  sectionId: string | null;
  teacherId: string | null;
  status: string;
  endedAt: Date | null;
};

const GRADES: Record<string, { type: string; deletedAt: Date | null; schoolId: string }> = {
  [GRADE]: { type: "G3", deletedAt: null, schoolId: SCHOOL },
  [GRADE_4]: { type: "G4", deletedAt: null, schoolId: SCHOOL },
  "grade-floating": { type: "FLOATING", deletedAt: null, schoolId: SCHOOL },
  "grade-x": { type: "G3", deletedAt: null, schoolId: OTHER_SCHOOL },
};
const USERS: Record<string, { id: string; fullName: string; deletedAt: Date | null; isActive: boolean; role: string }> = {
  [TEACHER]: { id: TEACHER, fullName: "Ana Cruz", deletedAt: null, isActive: true, role: "TEACHER" },
  [OTHER_TEACHER]: { id: OTHER_TEACHER, fullName: "Ben Reyes", deletedAt: null, isActive: true, role: "TEACHER" },
  [ADVISER_B]: { id: ADVISER_B, fullName: "Carla Diaz", deletedAt: null, isActive: true, role: "TEACHER" },
  "adviser-off": { id: "adviser-off", fullName: "Off", deletedAt: null, isActive: false, role: "TEACHER" },
};

let db: {
  learners: LearnerRow[];
  sections: SectionRow[];
  requests: RequestRow[];
  enrollments: EnrollmentRow[];
  activeYear: { id: string } | null;
};

function learner(id: string, over: Partial<LearnerRow> = {}): LearnerRow {
  return {
    id,
    schoolId: SCHOOL,
    gradeLevelId: GRADE,
    sectionId: "sec-a",
    teacherId: TEACHER,
    aralTeacherId: null,
    deletedAt: null,
    archivedAt: null,
    ...over,
  };
}
function request(id: string, over: Partial<RequestRow> = {}): RequestRow {
  return {
    id,
    schoolId: SCHOOL,
    learnerId: "l-1",
    requestedById: TEACHER,
    fromSectionId: "sec-a",
    toSectionId: "sec-b",
    status: "PENDING",
    reason: null,
    decidedById: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: new Date("2026-10-01"),
    ...over,
  };
}

// ── a tiny where-matcher ──────────────────────────────────────────────────
type Where = Record<string, unknown>;
function matchField(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("not" in c) return value !== c.not;
    if ("gte" in c) return value instanceof Date && value >= (c.gte as Date);
    throw new Error(`unsupported condition ${JSON.stringify(cond)}`);
  }
  return value === cond;
}
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "OR") {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as Where[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (!matchField(row[key], cond)) return false;
  }
  return true;
}

function learnerView(l: LearnerRow) {
  return { ...l, gradeLevel: { type: GRADES[l.gradeLevelId].type }, fullName: `Learner ${l.id}` };
}
function sectionView(s: SectionRow) {
  const adviser = s.adviserId ? USERS[s.adviserId] ?? null : null;
  return {
    ...s,
    gradeLevel: { deletedAt: GRADES[s.gradeLevelId].deletedAt, type: GRADES[s.gradeLevelId].type },
    adviser,
  };
}

const calls = { transaction: 0 };

function makeClient() {
  const client = {
    learner: {
      findMany: vi.fn(async (args: { where: Where }) =>
        db.learners.filter((l) => matches(l, args.where)).map(learnerView)
      ),
      updateMany: vi.fn(async (args: { where: Where; data: Partial<LearnerRow> }) => {
        const hit = db.learners.filter((l) => matches(l, args.where));
        for (const l of hit) Object.assign(l, args.data);
        return { count: hit.length };
      }),
    },
    section: {
      findFirst: vi.fn(async (args: { where: Where }) => {
        const s = db.sections.find((row) => matches(row, args.where));
        return s ? sectionView(s) : null;
      }),
      findMany: vi.fn(async (args: { where: Where }) =>
        db.sections.filter((s) => matches(s, args.where)).map(sectionView)
      ),
    },
    sectionTransferRequest: {
      findMany: vi.fn(async (args: { where: Where }) => db.requests.filter((r) => matches(r, args.where))),
      createMany: vi.fn(async (args: { data: Partial<RequestRow>[] }) => {
        for (const d of args.data) {
          if (db.requests.some((r) => r.learnerId === d.learnerId && r.status === "PENDING")) {
            throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
          }
        }
        for (const d of args.data) db.requests.push(request(`new-${db.requests.length}`, d));
        return { count: args.data.length };
      }),
      updateMany: vi.fn(async (args: { where: Where; data: Partial<RequestRow> }) => {
        const hit = db.requests.filter((r) => matches(r, args.where));
        for (const r of hit) Object.assign(r, args.data);
        return { count: hit.length };
      }),
    },
    enrollment: {
      findMany: vi.fn(async (args: { where: Where }) => db.enrollments.filter((e) => matches(e, args.where))),
      updateMany: vi.fn(async (args: { where: Where; data: Partial<EnrollmentRow> }) => {
        const hit = db.enrollments.filter((e) => matches(e, args.where));
        for (const e of hit) Object.assign(e, args.data);
        return { count: hit.length };
      }),
      createMany: vi.fn(async (args: { data: Omit<EnrollmentRow, "id" | "endedAt">[] }) => {
        for (const d of args.data) {
          if (db.enrollments.some((e) => e.learnerId === d.learnerId && e.status === "ACTIVE")) {
            throw new Error("Enrollment_learner_active_unique violated");
          }
          db.enrollments.push({ ...d, id: `en-${db.enrollments.length}`, endedAt: null });
        }
        return { count: args.data.length };
      }),
    },
    schoolYear: {
      findFirst: vi.fn(async () => db.activeYear),
    },
  };
  return client;
}

let client = makeClient();

/** Snapshot/restore so a throw inside the transaction rolls the fake back. */
async function transaction<T>(cb: (tx: ReturnType<typeof makeClient>) => Promise<T>): Promise<T> {
  calls.transaction += 1;
  const snapshot = structuredClone(db);
  try {
    return await cb(client);
  } catch (err) {
    db = snapshot;
    throw err;
  }
}

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, prop) => (prop === "$transaction" ? transaction : (client as Record<string, unknown>)[prop as string]),
    }
  ),
}));

let currentUser: { id: string; schoolId: string; role: string; profileCompleted: boolean };
const requireSchoolUser = vi.fn(async (_role?: unknown) => currentUser);
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...a: unknown[]) => requireSchoolUser(...(a as [])),
}));

const assertSameSchool = vi.fn(
  (userSchoolId: string, resourceSchoolId: string | null | undefined, resource?: string) => {
    if (!resourceSchoolId || resourceSchoolId !== userSchoolId) {
      throw resourceNotFound(resource ?? "Record", { crossTenant: Boolean(resourceSchoolId) });
    }
  }
);
vi.mock("@/lib/auth/tenant", () => ({
  assertSameSchool: (...a: unknown[]) => assertSameSchool(...(a as [string, string | null | undefined, string?])),
}));

const getAdvisoryPlacements = vi.fn(async (user: { id: string; schoolId: string }) =>
  db.sections
    .filter((s) => s.adviserId === user.id && s.schoolId === user.schoolId && s.deletedAt === null)
    .map((s) => ({ sectionId: s.id, sectionName: s.name, gradeLevelId: s.gradeLevelId }))
);
vi.mock("@/lib/teachers/advisory", () => ({
  getAdvisoryPlacements: (...a: unknown[]) => getAdvisoryPlacements(...(a as [{ id: string; schoolId: string }])),
}));

const writeAuditMany = vi.fn(async (_entries: unknown[]) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async () => {}),
  writeAuditMany: (...a: unknown[]) => writeAuditMany(...(a as [unknown[]])),
  AUDIT_ACTIONS: { LEARNER_TRANSFER: "LEARNER_TRANSFER" },
}));

const revalidateSectionTransfer = vi.fn();
const revalidateTransferRequests = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSectionTransfer: (...a: unknown[]) => revalidateSectionTransfer(...a),
  revalidateTransferRequests: (...a: unknown[]) => revalidateTransferRequests(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TEST") }));

const {
  transferLearnersToSection,
  requestSectionTransfers,
  approveSectionTransferRequests,
  declineSectionTransferRequests,
  cancelSectionTransferRequest,
} = await import("@/lib/actions/section-transfer");

const asHead = () => {
  currentUser = { id: HEAD, schoolId: SCHOOL, role: "SCHOOL_HEAD", profileCompleted: true };
};
const asTeacher = (id = TEACHER) => {
  currentUser = { id, schoolId: SCHOOL, role: "TEACHER", profileCompleted: true };
};

function activeEnrollment(learnerId: string, sectionId = "sec-a"): EnrollmentRow {
  return {
    id: `en-${learnerId}`,
    learnerId,
    schoolId: SCHOOL,
    schoolYearId: "sy-1",
    gradeLevelId: GRADE,
    sectionId,
    teacherId: TEACHER,
    status: "ACTIVE",
    endedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.transaction = 0;
  client = makeClient();
  db = {
    learners: [
      learner("l-1"),
      learner("l-2"),
      learner("l-3", { sectionId: "sec-b", teacherId: ADVISER_B }),
      learner("l-other", { schoolId: OTHER_SCHOOL, gradeLevelId: "grade-x", sectionId: "sec-x" }),
      learner("l-g4", { gradeLevelId: GRADE_4, sectionId: "sec-g4" }),
      learner("l-archived", { archivedAt: new Date("2026-09-01") }),
    ],
    sections: [
      { id: "sec-a", name: "Rosal", schoolId: SCHOOL, gradeLevelId: GRADE, deletedAt: null, adviserId: TEACHER },
      { id: "sec-b", name: "Sampaguita", schoolId: SCHOOL, gradeLevelId: GRADE, deletedAt: null, adviserId: ADVISER_B },
      { id: "sec-c", name: "Ilang", schoolId: SCHOOL, gradeLevelId: GRADE, deletedAt: null, adviserId: OTHER_TEACHER },
      { id: "sec-off", name: "Off", schoolId: SCHOOL, gradeLevelId: GRADE, deletedAt: null, adviserId: "adviser-off" },
      { id: "sec-gone", name: "Gone", schoolId: SCHOOL, gradeLevelId: GRADE, deletedAt: new Date(), adviserId: ADVISER_B },
      { id: "sec-g4", name: "Mabini", schoolId: SCHOOL, gradeLevelId: GRADE_4, deletedAt: null, adviserId: OTHER_TEACHER },
      { id: "sec-x", name: "Elsewhere", schoolId: OTHER_SCHOOL, gradeLevelId: "grade-x", deletedAt: null, adviserId: null },
    ],
    requests: [],
    enrollments: [activeEnrollment("l-1"), activeEnrollment("l-2")],
    activeYear: { id: "sy-1" },
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const byId = (id: string) => db.learners.find((l) => l.id === id)!;

// ── transferLearnersToSection ──────────────────────────────────────────────

describe("transferLearnersToSection (School Head)", () => {
  beforeEach(asHead);

  it("moves every learner, sets the new adviser, and swaps the ACTIVE enrollment", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-1", "l-2"], toSectionId: "sec-b" });

    expect(res).toEqual({ ok: true, data: { moved: 2, unchanged: 0, sectionName: "Sampaguita" } });
    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    expect(byId("l-1")).toMatchObject({ sectionId: "sec-b", teacherId: ADVISER_B });
    expect(byId("l-2")).toMatchObject({ sectionId: "sec-b", teacherId: ADVISER_B });
    const active = db.enrollments.filter((e) => e.status === "ACTIVE");
    expect(active.map((e) => [e.learnerId, e.sectionId, e.teacherId]).sort()).toEqual([
      ["l-1", "sec-b", ADVISER_B],
      ["l-2", "sec-b", ADVISER_B],
    ]);
    expect(db.enrollments.filter((e) => e.status === "TRANSFERRED")).toHaveLength(2);

    expect(writeAuditMany).toHaveBeenCalledTimes(1);
    const entries = writeAuditMany.mock.calls[0][0] as { action: string; metadata: Record<string, unknown> }[];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      action: "LEARNER_TRANSFER",
      metadata: { source: "direct", fromSectionId: "sec-a", toSectionId: "sec-b" },
    });
    expect(revalidateSectionTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: SCHOOL, gradeLevelId: GRADE })
    );
  });

  it("reports learners already in the section as unchanged and moves the rest", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-1", "l-3"], toSectionId: "sec-b" });
    expect(res).toEqual({ ok: true, data: { moved: 1, unchanged: 1, sectionName: "Sampaguita" } });
  });

  it("refuses another school's learner as NOT_FOUND and writes nothing", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-1", "l-other"], toSectionId: "sec-b" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(assertSameSchool).toHaveBeenCalledWith(SCHOOL, OTHER_SCHOOL, "Learner");
    expect(JSON.stringify(res)).not.toContain(OTHER_SCHOOL);
    expect(calls.transaction).toBe(0);
    expect(byId("l-1").sectionId).toBe("sec-a");
  });

  it("refuses a missing learner with the same NOT_FOUND", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-1", "nope"], toSectionId: "sec-b" });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(calls.transaction).toBe(0);
  });

  it("refuses another school's section as a field error, without naming it", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-1"], toSectionId: "sec-x" });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED", fieldErrors: { toSectionId: expect.any(String) } });
    expect(JSON.stringify(res)).not.toContain("Elsewhere");
    expect(calls.transaction).toBe(0);
  });

  it("is all-or-nothing: one learner from another grade blocks the whole batch", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-1", "l-g4"], toSectionId: "sec-b" });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_BLOCKED" });
    expect((res as { error: string }).error).toContain("1 learner");
    expect(calls.transaction).toBe(0);
    expect(byId("l-1").sectionId).toBe("sec-a");
  });

  it("refuses an archived learner", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-archived"], toSectionId: "sec-b" });
    expect(res).toMatchObject({ ok: false, code: "TRANSFER_BLOCKED" });
    expect(byId("l-archived").sectionId).toBe("sec-a");
  });

  it("refuses a section whose adviser is inactive", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-1"], toSectionId: "sec-off" });
    expect(res).toMatchObject({ ok: false, code: "TRANSFER_BLOCKED" });
  });

  it("refuses an archived section", async () => {
    const res = await transferLearnersToSection({ learnerIds: ["l-1"], toSectionId: "sec-gone" });
    expect(res).toMatchObject({ ok: false, code: "TRANSFER_BLOCKED" });
  });

  it("a pending request blocks a direct transfer of that learner", async () => {
    db.requests.push(request("r-1", { learnerId: "l-2", toSectionId: "sec-c" }));

    const res = await transferLearnersToSection({ learnerIds: ["l-1", "l-2"], toSectionId: "sec-b" });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUEST_PENDING" });
    expect(calls.transaction).toBe(0);
    expect(byId("l-1").sectionId).toBe("sec-a");
  });

  it("one pending learner inside a multi-learner batch blocks the whole batch, nothing written", async () => {
    db.requests.push(request("r-1", { learnerId: "l-2", toSectionId: "sec-c" }));

    const res = await transferLearnersToSection({ learnerIds: ["l-1", "l-2"], toSectionId: "sec-b" });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUEST_PENDING" });
    expect(calls.transaction).toBe(0);
    expect(client.learner.updateMany).not.toHaveBeenCalled();
    expect(client.enrollment.createMany).not.toHaveBeenCalled();
    expect(writeAuditMany).not.toHaveBeenCalled();
    expect(byId("l-1")).toMatchObject({ sectionId: "sec-a", teacherId: TEACHER });
    expect(byId("l-2")).toMatchObject({ sectionId: "sec-a", teacherId: TEACHER });
    expect(db.enrollments.filter((e) => e.status === "ACTIVE" && e.sectionId === "sec-a")).toHaveLength(2);
    expect(db.requests[0].status).toBe("PENDING");
  });

  it("rolls everything back when a learner moved between the read and the write", async () => {
    const original = client.learner.findMany.getMockImplementation()!;
    client.learner.findMany.mockImplementationOnce(async (args: { where: Where }) => {
      const rows = await original(args);
      // Another session moves l-2 after this read.
      byId("l-2").sectionId = "sec-c";
      return rows;
    });

    const res = await transferLearnersToSection({ learnerIds: ["l-1", "l-2"], toSectionId: "sec-b" });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUESTS_CHANGED" });
    expect(byId("l-1").sectionId).toBe("sec-a");
    expect(db.enrollments.filter((e) => e.status === "ACTIVE" && e.sectionId === "sec-b")).toHaveLength(0);
    expect(writeAuditMany).not.toHaveBeenCalled();
  });
});

// ── requestSectionTransfers ─────────────────────────────────────────────────

describe("requestSectionTransfers (Teacher)", () => {
  beforeEach(() => asTeacher());

  it("creates one PENDING request per learner in the teacher's advisory", async () => {
    const res = await requestSectionTransfers({ learnerIds: ["l-1", "l-2"], toSectionId: "sec-b", reason: "Sibling" });

    expect(res).toEqual({ ok: true, data: { requested: 2, unchanged: 0 } });
    expect(requireSchoolUser).toHaveBeenCalledWith("TEACHER");
    expect(db.requests).toHaveLength(2);
    expect(db.requests[0]).toMatchObject({
      schoolId: SCHOOL,
      learnerId: "l-1",
      requestedById: TEACHER,
      fromSectionId: "sec-a",
      toSectionId: "sec-b",
      status: "PENDING",
      reason: "Sibling",
    });
    // Nothing moved yet.
    expect(byId("l-1").sectionId).toBe("sec-a");
    expect(revalidateTransferRequests).toHaveBeenCalledWith(SCHOOL);
  });

  it("counts a learner already in the destination section as unchanged and creates no request for them", async () => {
    // l-1 and l-2 both already sit in sec-a.
    const res = await requestSectionTransfers({ learnerIds: ["l-1", "l-2"], toSectionId: "sec-a" });

    expect(res).toEqual({ ok: true, data: { requested: 0, unchanged: 2 } });
    expect(db.requests).toHaveLength(0);
  });

  it("is limited to the teacher's advisory sections", async () => {
    // l-3 sits in sec-b, advised by somebody else.
    const res = await requestSectionTransfers({ learnerIds: ["l-1", "l-3"], toSectionId: "sec-c" });

    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toMatch(/advisory/i);
    expect(db.requests).toHaveLength(0);
  });

  it("gives the same answer for another school's learner", async () => {
    const res = await requestSectionTransfers({ learnerIds: ["l-1", "l-other"], toSectionId: "sec-b" });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toMatch(/advisory/i);
    expect(JSON.stringify(res)).not.toContain(OTHER_SCHOOL);
    expect(db.requests).toHaveLength(0);
  });

  it("only asks the database for learners in the teacher's own school and sections", async () => {
    await requestSectionTransfers({ learnerIds: ["l-1"], toSectionId: "sec-b" });
    expect(client.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: SCHOOL,
          deletedAt: null,
          archivedAt: null,
          sectionId: { in: ["sec-a"] },
        }),
      })
    );
  });

  it("refuses when a request is already waiting for one of the learners", async () => {
    db.requests.push(request("r-1", { learnerId: "l-2" }));
    const res = await requestSectionTransfers({ learnerIds: ["l-1", "l-2"], toSectionId: "sec-b" });
    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUEST_PENDING" });
    expect(db.requests).toHaveLength(1);
  });

  /** A Prisma P2002 as @prisma/adapter-pg reports it (no `meta.target`). */
  function uniqueViolation(fields: string[]) {
    return Object.assign(new Error("Unique constraint failed"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { fields } } } },
    });
  }

  it("maps a racing pending-request unique violation to TRANSFER_REQUEST_PENDING (user severity)", async () => {
    // The pending-request read saw nothing; a concurrent request landed before the insert.
    client.sectionTransferRequest.createMany.mockRejectedValueOnce(uniqueViolation(['"learnerId"']));

    const res = await requestSectionTransfers({ learnerIds: ["l-1"], toSectionId: "sec-b" });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUEST_PENDING" });
    expect((res as { error: string }).error).toContain("1 learner already has");
    expect(revalidateTransferRequests).not.toHaveBeenCalled();
  });

  it("leaves any other unique violation to action() as DB_CONFLICT", async () => {
    client.sectionTransferRequest.createMany.mockRejectedValueOnce(uniqueViolation(["id"]));

    const res = await requestSectionTransfers({ learnerIds: ["l-1"], toSectionId: "sec-b" });

    expect(res).toMatchObject({ ok: false, code: "DB_CONFLICT" });
  });

  it("refuses a teacher whose profile is not complete", async () => {
    currentUser = { ...currentUser, profileCompleted: false };
    const res = await requestSectionTransfers({ learnerIds: ["l-1"], toSectionId: "sec-b" });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(db.requests).toHaveLength(0);
  });
});

// ── approveSectionTransferRequests ──────────────────────────────────────────

describe("approveSectionTransferRequests (School Head)", () => {
  beforeEach(asHead);

  it("approves and applies the move with the destination's current adviser", async () => {
    db.requests.push(request("r-1", { learnerId: "l-1" }), request("r-2", { learnerId: "l-2", toSectionId: "sec-c" }));

    const res = await approveSectionTransferRequests({ requestIds: ["r-1", "r-2"] });

    expect(res).toEqual({ ok: true, data: { approved: 2 } });
    expect(db.requests.map((r) => [r.id, r.status, r.decidedById])).toEqual([
      ["r-1", "APPROVED", HEAD],
      ["r-2", "APPROVED", HEAD],
    ]);
    expect(byId("l-1")).toMatchObject({ sectionId: "sec-b", teacherId: ADVISER_B });
    expect(byId("l-2")).toMatchObject({ sectionId: "sec-c", teacherId: OTHER_TEACHER });
    const entries = writeAuditMany.mock.calls[0][0] as { metadata: Record<string, unknown> }[];
    expect(entries[0].metadata).toMatchObject({ source: "request", requestId: "r-1" });
    expect(JSON.stringify(entries)).not.toContain("reason");
  });

  it("refuses another school's request as NOT_FOUND", async () => {
    db.requests.push(request("r-1"), request("r-x", { schoolId: OTHER_SCHOOL, learnerId: "l-other" }));
    const res = await approveSectionTransferRequests({ requestIds: ["r-1", "r-x"] });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(assertSameSchool).toHaveBeenCalledWith(SCHOOL, OTHER_SCHOOL, "Transfer request");
    expect(db.requests[0].status).toBe("PENDING");
  });

  it("refuses an already-decided request", async () => {
    db.requests.push(request("r-1", { status: "CANCELLED", decidedAt: new Date() }));
    const res = await approveSectionTransferRequests({ requestIds: ["r-1"] });
    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUESTS_CHANGED" });
  });

  it("refuses a stale request (learner moved since) and approves none of the batch", async () => {
    db.requests.push(request("r-1", { learnerId: "l-1" }), request("r-2", { learnerId: "l-2" }));
    byId("l-2").sectionId = "sec-c";

    const res = await approveSectionTransferRequests({ requestIds: ["r-1", "r-2"] });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_STALE" });
    expect(db.requests.every((r) => r.status === "PENDING")).toBe(true);
    expect(byId("l-1").sectionId).toBe("sec-a");
  });

  it("refuses a request whose destination lost its adviser", async () => {
    db.requests.push(request("r-1", { learnerId: "l-1", toSectionId: "sec-off" }));
    const res = await approveSectionTransferRequests({ requestIds: ["r-1"] });
    expect(res).toMatchObject({ ok: false, code: "TRANSFER_STALE" });
  });

  it("rolls back when the request compare-and-set loses a race (double approve / cancel)", async () => {
    db.requests.push(request("r-1", { learnerId: "l-1" }), request("r-2", { learnerId: "l-2" }));
    const original = client.sectionTransferRequest.updateMany.getMockImplementation()!;
    client.sectionTransferRequest.updateMany.mockImplementationOnce(async (args) => {
      // A concurrent decision on r-2 lands first.
      db.requests[1].status = "CANCELLED";
      return original(args);
    });

    const res = await approveSectionTransferRequests({ requestIds: ["r-1", "r-2"] });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUESTS_CHANGED" });
    expect(db.requests[0].status).toBe("PENDING");
    expect(byId("l-1").sectionId).toBe("sec-a");
    expect(writeAuditMany).not.toHaveBeenCalled();
  });
});

// ── Super Admin ─────────────────────────────────────────────────────────────

describe("Super Admin is refused by the School Head transfer actions", () => {
  /**
   * The real `requireSchoolUser` lets a Super Admin past the role check, finds
   * no schoolId and redirects home. Mirror that: the redirect is thrown, and
   * `action()` rethrows it rather than turning it into a result.
   */
  beforeEach(() => {
    currentUser = { id: "admin-1", schoolId: null as unknown as string, role: "SUPER_ADMIN", profileCompleted: true };
    requireSchoolUser.mockImplementationOnce(async () => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/admin;307;" });
    });
  });

  it("transferLearnersToSection throws the redirect and writes nothing", async () => {
    await expect(transferLearnersToSection({ learnerIds: ["l-1"], toSectionId: "sec-b" })).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    expect(calls.transaction).toBe(0);
    expect(client.learner.findMany).not.toHaveBeenCalled();
    expect(byId("l-1").sectionId).toBe("sec-a");
    expect(writeAuditMany).not.toHaveBeenCalled();
  });

  it("approveSectionTransferRequests throws the redirect and writes nothing", async () => {
    db.requests.push(request("r-1", { learnerId: "l-1" }));
    await expect(approveSectionTransferRequests({ requestIds: ["r-1"] })).rejects.toThrow("NEXT_REDIRECT");
    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    expect(calls.transaction).toBe(0);
    expect(db.requests[0].status).toBe("PENDING");
    expect(byId("l-1").sectionId).toBe("sec-a");
    expect(writeAuditMany).not.toHaveBeenCalled();
  });
});

// ── declineSectionTransferRequests ──────────────────────────────────────────

describe("declineSectionTransferRequests (School Head)", () => {
  beforeEach(asHead);

  it("declines with a note, even when the request is stale", async () => {
    db.requests.push(request("r-1", { learnerId: "l-1" }));
    byId("l-1").sectionId = "sec-c"; // stale

    const res = await declineSectionTransferRequests({ requestIds: ["r-1"], note: "Class is full" });

    expect(res).toEqual({ ok: true, data: { declined: 1 } });
    expect(db.requests[0]).toMatchObject({ status: "REJECTED", decidedById: HEAD, decisionNote: "Class is full" });
    expect(revalidateTransferRequests).toHaveBeenCalledWith(SCHOOL);
  });

  it("refuses another school's request as NOT_FOUND", async () => {
    db.requests.push(request("r-x", { schoolId: OTHER_SCHOOL, learnerId: "l-other" }));
    const res = await declineSectionTransferRequests({ requestIds: ["r-x"] });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(db.requests[0].status).toBe("PENDING");
  });

  it("rolls back when one of the batch was decided meanwhile", async () => {
    db.requests.push(request("r-1", { learnerId: "l-1" }), request("r-2", { learnerId: "l-2" }));
    const original = client.sectionTransferRequest.updateMany.getMockImplementation()!;
    client.sectionTransferRequest.updateMany.mockImplementationOnce(async (args) => {
      db.requests[1].status = "APPROVED";
      return original(args);
    });

    const res = await declineSectionTransferRequests({ requestIds: ["r-1", "r-2"] });

    expect(res).toMatchObject({ ok: false, code: "TRANSFER_REQUESTS_CHANGED" });
    expect(db.requests[0].status).toBe("PENDING");
  });
});

// ── cancelSectionTransferRequest ────────────────────────────────────────────

describe("cancelSectionTransferRequest (Teacher)", () => {
  it("lets the requester withdraw their own pending request", async () => {
    asTeacher();
    db.requests.push(request("r-1"));

    const res = await cancelSectionTransferRequest({ requestId: "r-1" });

    expect(res).toEqual({ ok: true });
    expect(db.requests[0]).toMatchObject({ status: "CANCELLED", decidedById: TEACHER });
  });

  it("refuses somebody else's request as NOT_FOUND", async () => {
    asTeacher(OTHER_TEACHER);
    db.requests.push(request("r-1"));

    const res = await cancelSectionTransferRequest({ requestId: "r-1" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(db.requests[0].status).toBe("PENDING");
  });

  it("refuses a request from another school even with a matching requester id", async () => {
    asTeacher();
    db.requests.push(request("r-x", { schoolId: OTHER_SCHOOL }));
    const res = await cancelSectionTransferRequest({ requestId: "r-x" });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(db.requests[0].status).toBe("PENDING");
  });
});
