import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The support actions: who may raise a ticket, who may answer one, and what
 * never leaves this module.
 *
 * The tests worth reading here are the ones about the second question. Answering
 * a ticket is the only place in LITRACK where a role can widen what somebody else
 * is allowed to write, so three properties are asserted deliberately:
 *
 * - **A grant follows the ticket, never the request.** The window that gets
 *   reopened is read from the stored ticket row, so a caller cannot ask for a
 *   different week than the one they filed about, and cannot get a grant at all
 *   on a ticket that named no window.
 * - **An answered ticket cannot be answered again.** Otherwise a resolved
 *   request would stay a standing key to whatever window it named.
 * - **Neither the subject nor the body reaches an audit row or a notification.**
 *   They are free text about somebody's class, so they will name learners.
 *
 * Everything is mocked at the module boundary, matching the other action tests
 * in this directory: real Prisma, real Supabase, and real Redis are all out of
 * scope for a unit test of the decision logic.
 */

const create = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
const userFindMany = vi.fn();
const notificationCreate = vi.fn();
const notificationCreateMany = vi.fn();
const grantUpsert = vi.fn();
const grantFindUnique = vi.fn();
const grantUpdate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    supportTicket: {
      get create() {
        return create;
      },
      get findUnique() {
        return findUnique;
      },
      get update() {
        return update;
      },
    },
    user: {
      get findMany() {
        return userFindMany;
      },
    },
    notification: {
      get create() {
        return notificationCreate;
      },
      get createMany() {
        return notificationCreateMany;
      },
    },
    unlockGrant: {
      get upsert() {
        return grantUpsert;
      },
      get findUnique() {
        return grantFindUnique;
      },
      get update() {
        return grantUpdate;
      },
    },
    get $transaction() {
      return transaction;
    },
  },
}));

const requireSchoolUser = vi.fn();
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...args),
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
  AUDIT_ACTIONS: {
    SUPPORT_TICKET_SUBMIT: "SUPPORT_TICKET_SUBMIT",
    SUPPORT_TICKET_RESOLVE: "SUPPORT_TICKET_RESOLVE",
    SUPPORT_TICKET_DECLINE: "SUPPORT_TICKET_DECLINE",
    UNLOCK_GRANT_ISSUE: "UNLOCK_GRANT_ISSUE",
    UNLOCK_GRANT_REVOKE: "UNLOCK_GRANT_REVOKE",
  },
}));

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

const listMyTickets = vi.fn();
vi.mock("@/lib/support/queries", () => ({
  listMyTickets: (...args: unknown[]) => listMyTickets(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const revalidateSupportTicket = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSupportTicket: (...a: unknown[]) => revalidateSupportTicket(...a),
}));

// Imported after the mock factories above are registered.
const {
  declineTicket,
  fetchMyTickets,
  resolveTicket,
  revokeUnlockGrant,
  submitTicket,
} = await import("@/lib/actions/support");

const TEACHER = { id: "teacher-1", schoolId: "school-1", role: "TEACHER" };
const ADMIN = { id: "admin-1", schoolId: null, role: "SUPER_ADMIN" };

const TICKET_ID = "3f0c2f9c-6d1e-4b6f-9a2a-8f4e7c1b5d90";
const GRANT_ID = "9b1e4f0a-2c3d-4e5f-8a7b-6c5d4e3f2a10";
const WEEK_A = "2026-08-24";

/** The subject and body every PII assertion below looks for. */
const SUBJECT = "Cannot mark Reyes, Ana";
const BODY = "Ana Reyes and two others are unmarked and the week closed on me.";

function unlockRequest(overrides: Record<string, unknown> = {}) {
  return {
    category: "UNLOCK_REQUEST",
    subject: SUBJECT,
    body: BODY,
    requestedScope: "ARAL_WEEKLY_ATTENDANCE",
    requestedTargetKey: WEEK_A,
    ...overrides,
  };
}

/** A stored ticket as `resolveTicket` selects it. */
function storedTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    schoolId: "school-1",
    requesterId: "teacher-1",
    category: "UNLOCK_REQUEST",
    status: "OPEN",
    requestedScope: "ARAL_WEEKLY_ATTENDANCE",
    requestedTargetKey: WEEK_A,
    ...overrides,
  };
}

/** Runs the transaction callback against a tx double, returning its result. */
function runTransaction() {
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      supportTicket: { update },
      unlockGrant: { upsert: grantUpsert },
    })
  );
}

/** Every value that reached an audit row or a notification, flattened to text. */
function allWrittenText(): string {
  return JSON.stringify([
    writeAudit.mock.calls,
    notificationCreate.mock.calls,
    notificationCreateMany.mock.calls,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSchoolUser.mockResolvedValue(TEACHER);
  requireUser.mockResolvedValue(ADMIN);
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  create.mockResolvedValue({ id: TICKET_ID });
  userFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
  notificationCreateMany.mockResolvedValue({ count: 2 });
  notificationCreate.mockResolvedValue({ id: "notif-1" });
  update.mockResolvedValue({ id: TICKET_ID });
  grantUpsert.mockResolvedValue({ id: GRANT_ID });
  grantUpdate.mockResolvedValue({ id: GRANT_ID });
  runTransaction();
});

describe("submitTicket", () => {
  it("files the ticket against the requester's own school", async () => {
    const result = await submitTicket(unlockRequest());

    expect(result).toEqual({ ok: true, data: { id: TICKET_ID } });
    expect(create.mock.calls[0]?.[0]?.data).toMatchObject({
      schoolId: "school-1",
      requesterId: "teacher-1",
      requestedScope: "ARAL_WEEKLY_ATTENDANCE",
      requestedTargetKey: WEEK_A,
    });
  });

  it("takes the school and requester from the session, never from the input", async () => {
    // The tenancy story for this action in one assertion: a caller who names
    // another school in the payload still files against their own.
    await submitTicket(
      unlockRequest({ schoolId: "school-2", requesterId: "someone-else" })
    );

    expect(create.mock.calls[0]?.[0]?.data).toMatchObject({
      schoolId: "school-1",
      requesterId: "teacher-1",
    });
  });

  it("only lets a teacher or school head file", async () => {
    await submitTicket(unlockRequest());
    expect(requireSchoolUser).toHaveBeenCalledWith(["TEACHER", "SCHOOL_HEAD"]);
  });

  it("stores no target key on a category that cannot carry one", async () => {
    await submitTicket({
      category: "BUG_REPORT",
      subject: SUBJECT,
      body: BODY,
    });

    expect(create.mock.calls[0]?.[0]?.data).toMatchObject({
      requestedScope: null,
      requestedTargetKey: null,
    });
  });

  it("rejects invalid input before touching the database", async () => {
    const result = await submitTicket({ category: "UNLOCK_REQUEST", subject: "", body: "" });

    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("stops at the rate limit and says when to retry", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 20 * 60 * 1000 });

    const result = await submitTicket(unlockRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("20 minutes");
    expect(create).not.toHaveBeenCalled();
  });

  it("rate limits per person, five an hour", async () => {
    await submitTicket(unlockRequest());

    expect(checkRateLimit).toHaveBeenCalledWith("support-ticket:teacher-1", {
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
  });

  it("notifies every active admin, one row each", async () => {
    await submitTicket(unlockRequest());

    const rows = notificationCreateMany.mock.calls[0]?.[0]?.data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      recipientId: "admin-1",
      actorId: "teacher-1",
      type: "SUPPORT_TICKET_SUBMITTED",
      ticketId: TICKET_ID,
    });
    expect(userFindMany.mock.calls[0]?.[0]?.where).toMatchObject({
      role: "SUPER_ADMIN",
      isActive: true,
      deletedAt: null,
    });
  });

  it("still succeeds when there is no admin to notify", async () => {
    userFindMany.mockResolvedValue([]);

    const result = await submitTicket(unlockRequest());

    expect(result.ok).toBe(true);
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });

  it("keeps the subject and body out of the audit row and the notification", async () => {
    // The rule this whole module is built around. The audit row carries the
    // category, the scope, and a count — never the person's own words.
    await submitTicket(unlockRequest());

    const written = allWrittenText();
    expect(written).not.toContain("Reyes");
    expect(written).not.toContain(SUBJECT);
    expect(written).not.toContain(BODY);

    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({
      action: "SUPPORT_TICKET_SUBMIT",
      resource: "SupportTicket",
      resourceId: TICKET_ID,
      metadata: {
        category: "UNLOCK_REQUEST",
        requestedScope: "ARAL_WEEKLY_ATTENDANCE",
        notifiedAdmins: 2,
      },
    });
  });

  it("busts the requester's cached list and the admin inbox", async () => {
    await submitTicket(unlockRequest());

    expect(revalidateSupportTicket).toHaveBeenCalledWith("teacher-1");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/support");
  });
});

describe("resolveTicket", () => {
  it("is Super Admin only", async () => {
    findUnique.mockResolvedValue(storedTicket());

    await resolveTicket({ ticketId: TICKET_ID });

    expect(requireUser).toHaveBeenCalledWith(["SUPER_ADMIN"]);
  });

  it("resolves without granting anything when no grant is asked for", async () => {
    findUnique.mockResolvedValue(storedTicket());

    const result = await resolveTicket({ ticketId: TICKET_ID, note: "Reopened by hand" });

    expect(result).toEqual({ ok: true });
    expect(grantUpsert).not.toHaveBeenCalled();
    expect(update.mock.calls[0]?.[0]?.data).toMatchObject({
      status: "RESOLVED",
      resolverId: "admin-1",
      resolutionNote: "Reopened by hand",
    });
  });

  it("issues the grant against the window the ticket named", async () => {
    // Not the window the caller passed — the payload carries only a day count.
    // This is what stops a request about week A from becoming access to week B.
    findUnique.mockResolvedValue(storedTicket());

    const result = await resolveTicket({ ticketId: TICKET_ID, grant: { days: 3 } });

    expect(result).toEqual({ ok: true });
    const call = grantUpsert.mock.calls[0]?.[0];
    expect(call.where.userId_scope_targetKey).toEqual({
      userId: "teacher-1",
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_A,
    });
    expect(call.create).toMatchObject({
      schoolId: "school-1",
      userId: "teacher-1",
      targetKey: WEEK_A,
      grantedById: "admin-1",
      ticketId: TICKET_ID,
    });
  });

  it("dates the expiry the requested number of days out", async () => {
    findUnique.mockResolvedValue(storedTicket());
    const before = Date.now();

    await resolveTicket({ ticketId: TICKET_ID, grant: { days: 7 } });

    const expiresAt: Date = grantUpsert.mock.calls[0]?.[0]?.create?.expiresAt;
    const days = (expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it("clears a previous revocation when re-granting the same window", async () => {
    // A re-grant that left `revokedAt` set would write a fresh expiry onto a row
    // every read still treats as revoked — access that looks granted and is not.
    findUnique.mockResolvedValue(storedTicket());

    await resolveTicket({ ticketId: TICKET_ID, grant: { days: 5 } });

    expect(grantUpsert.mock.calls[0]?.[0]?.update).toMatchObject({
      revokedAt: null,
      revokedById: null,
      grantedById: "admin-1",
    });
  });

  it("closes the ticket and creates the grant in one transaction", async () => {
    findUnique.mockResolvedValue(storedTicket());

    await resolveTicket({ ticketId: TICKET_ID, grant: { days: 2 } });

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("refuses a grant on a ticket that named no window", async () => {
    findUnique.mockResolvedValue(
      storedTicket({
        category: "BUG_REPORT",
        requestedScope: null,
        requestedTargetKey: null,
      })
    );

    const result = await resolveTicket({ ticketId: TICKET_ID, grant: { days: 7 } });

    expect(result).toEqual({
      ok: false,
      error: "This request did not ask for access to a period",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(grantUpsert).not.toHaveBeenCalled();
  });

  it("refuses a grant on an unlock request missing its target key", async () => {
    findUnique.mockResolvedValue(storedTicket({ requestedTargetKey: null }));

    const result = await resolveTicket({ ticketId: TICKET_ID, grant: { days: 7 } });

    expect(result.ok).toBe(false);
    expect(grantUpsert).not.toHaveBeenCalled();
  });

  for (const status of ["RESOLVED", "DECLINED"] as const) {
    it(`refuses to answer a ${status} ticket again`, async () => {
      // Otherwise an answered request stays a standing key to its window.
      findUnique.mockResolvedValue(storedTicket({ status }));

      const result = await resolveTicket({ ticketId: TICKET_ID, grant: { days: 7 } });

      expect(result).toEqual({
        ok: false,
        error: "This request has already been answered",
      });
      expect(transaction).not.toHaveBeenCalled();
    });
  }

  it("says 'Not found' for a ticket that does not exist", async () => {
    findUnique.mockResolvedValue(null);

    expect(await resolveTicket({ ticketId: TICKET_ID })).toEqual({
      ok: false,
      error: "Not found",
    });
  });

  it("audits the grant by id, scope and expiry — never by the ticket's text", async () => {
    findUnique.mockResolvedValue(storedTicket());

    await resolveTicket({ ticketId: TICKET_ID, note: "Reopened for you", grant: { days: 4 } });

    expect(allWrittenText()).not.toContain("Reyes");

    const actions = writeAudit.mock.calls.map((call) => call[0].action);
    expect(actions).toEqual(["SUPPORT_TICKET_RESOLVE", "UNLOCK_GRANT_ISSUE"]);
    expect(writeAudit.mock.calls[0]?.[0]?.metadata).toEqual({
      category: "UNLOCK_REQUEST",
      granted: true,
    });
    expect(writeAudit.mock.calls[1]?.[0]?.metadata).toMatchObject({
      ticketId: TICKET_ID,
      userId: "teacher-1",
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_A,
    });
  });

  it("records granted: false when it only closed the ticket", async () => {
    findUnique.mockResolvedValue(storedTicket());

    await resolveTicket({ ticketId: TICKET_ID });

    expect(writeAudit.mock.calls[0]?.[0]?.metadata).toEqual({
      category: "UNLOCK_REQUEST",
      granted: false,
    });
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("tells the requester, carrying only the ticket id", async () => {
    findUnique.mockResolvedValue(storedTicket());

    await resolveTicket({ ticketId: TICKET_ID, note: "Reopened for you" });

    const data = notificationCreate.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({
      type: "SUPPORT_TICKET_RESOLVED",
      learnerIds: [],
    });
    expect(data.recipient.connect.id).toBe("teacher-1");
    expect(data.ticket.connect.id).toBe(TICKET_ID);
    expect(JSON.stringify(data)).not.toContain("Reopened for you");
  });

  it("busts the requester's caches, not the admin's own", async () => {
    findUnique.mockResolvedValue(storedTicket());

    await resolveTicket({ ticketId: TICKET_ID });

    expect(revalidateSupportTicket).toHaveBeenCalledWith("teacher-1");
  });
});

describe("declineTicket", () => {
  it("closes the ticket with the required reason and grants nothing", async () => {
    findUnique.mockResolvedValue(storedTicket());

    const result = await declineTicket({
      ticketId: TICKET_ID,
      note: "The term is already submitted to the division office.",
    });

    expect(result).toEqual({ ok: true });
    expect(update.mock.calls[0]?.[0]?.data).toMatchObject({
      status: "DECLINED",
      resolverId: "admin-1",
      resolutionNote: "The term is already submitted to the division office.",
    });
    expect(grantUpsert).not.toHaveBeenCalled();
  });

  it("refuses without a reason", async () => {
    const result = await declineTicket({ ticketId: TICKET_ID, note: "" });

    expect(result.ok).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("refuses to decline an already-answered ticket", async () => {
    findUnique.mockResolvedValue(storedTicket({ status: "RESOLVED" }));

    const result = await declineTicket({ ticketId: TICKET_ID, note: "Too late" });

    expect(result).toEqual({
      ok: false,
      error: "This request has already been answered",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("is Super Admin only", async () => {
    findUnique.mockResolvedValue(storedTicket());
    await declineTicket({ ticketId: TICKET_ID, note: "No." });
    expect(requireUser).toHaveBeenCalledWith(["SUPER_ADMIN"]);
  });
});

describe("revokeUnlockGrant", () => {
  it("marks the grant revoked instead of deleting it", async () => {
    // "Who could write into that closed week, and until when" has to stay
    // answerable after access ends.
    grantFindUnique.mockResolvedValue({
      id: GRANT_ID,
      schoolId: "school-1",
      userId: "teacher-1",
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_A,
      revokedAt: null,
    });

    const result = await revokeUnlockGrant({ grantId: GRANT_ID });

    expect(result).toEqual({ ok: true });
    expect(grantUpdate.mock.calls[0]?.[0]?.data).toMatchObject({
      revokedById: "admin-1",
    });
    expect(grantUpdate.mock.calls[0]?.[0]?.data.revokedAt).toBeInstanceOf(Date);
    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({
      action: "UNLOCK_GRANT_REVOKE",
      resourceId: GRANT_ID,
    });
  });

  it("is idempotent on a grant that was already revoked", async () => {
    grantFindUnique.mockResolvedValue({
      id: GRANT_ID,
      schoolId: "school-1",
      userId: "teacher-1",
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK_A,
      revokedAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const result = await revokeUnlockGrant({ grantId: GRANT_ID });

    expect(result).toEqual({ ok: true });
    expect(grantUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("says 'Not found' for a grant that does not exist", async () => {
    grantFindUnique.mockResolvedValue(null);

    expect(await revokeUnlockGrant({ grantId: GRANT_ID })).toEqual({
      ok: false,
      error: "Not found",
    });
  });

  it("refuses an id that is not a uuid", async () => {
    const result = await revokeUnlockGrant({ grantId: "all" });

    expect(result.ok).toBe(false);
    expect(grantFindUnique).not.toHaveBeenCalled();
  });
});

describe("fetchMyTickets", () => {
  it("returns only the caller's own tickets, without their bodies", async () => {
    // The panel lists subjects and outcomes. The body it already showed the
    // person once does not cross the wire again to be shown back to them.
    listMyTickets.mockResolvedValue([
      {
        id: TICKET_ID,
        category: "UNLOCK_REQUEST",
        status: "RESOLVED",
        subject: SUBJECT,
        body: BODY,
        createdAt: new Date("2026-09-01T02:00:00.000Z"),
        resolutionNote: "Reopened for a week",
        requestedScope: "ARAL_WEEKLY_ATTENDANCE",
        requestedTargetKey: WEEK_A,
        activeGrant: { id: GRANT_ID, expiresAt: new Date("2026-09-08T02:00:00.000Z") },
      },
    ]);
    requireUser.mockResolvedValue(TEACHER);

    const result = await fetchMyTickets();

    expect(listMyTickets).toHaveBeenCalledWith("teacher-1", 6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.[0]).toEqual({
      id: TICKET_ID,
      category: "UNLOCK_REQUEST",
      status: "RESOLVED",
      subject: SUBJECT,
      createdAt: new Date("2026-09-01T02:00:00.000Z"),
      resolutionNote: "Reopened for a week",
      requestedScope: "ARAL_WEEKLY_ATTENDANCE",
      requestedTargetKey: WEEK_A,
      grantExpiresAt: new Date("2026-09-08T02:00:00.000Z"),
    });
    expect(JSON.stringify(result.data)).not.toContain(BODY);
  });

  it("reports no grant expiry when the ticket produced none", async () => {
    listMyTickets.mockResolvedValue([
      {
        id: TICKET_ID,
        category: "OTHER",
        status: "OPEN",
        subject: "A question",
        body: "…",
        createdAt: new Date("2026-09-01T02:00:00.000Z"),
        resolutionNote: null,
        requestedScope: null,
        requestedTargetKey: null,
        activeGrant: null,
      },
    ]);

    const result = await fetchMyTickets();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.[0]?.grantExpiresAt).toBeNull();
  });

  it("returns an empty list for a Super Admin, who files no tickets", async () => {
    // `requireUser` with no role, so the panel renders for an admin too; the
    // empty list is the right answer rather than a refusal.
    requireUser.mockResolvedValue(ADMIN);
    listMyTickets.mockResolvedValue([]);

    const result = await fetchMyTickets();

    expect(result).toEqual({ ok: true, data: [] });
    expect(listMyTickets).toHaveBeenCalledWith("admin-1", 6);
  });
});
