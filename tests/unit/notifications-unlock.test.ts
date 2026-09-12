import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The read side of `UNLOCK_GRANTED` notifications: `getUnreadUnlockGrants` and
 * the `fetchUnlockAlerts` / `dismissUnlockAlerts` action pair that mirrors the
 * ARAL-assignment pair.
 *
 * Three contracts live here, same shape as `notifications.test.ts`:
 *
 *   - A notification only ever promises access the server would still honor.
 *     Revoked, expired, or SetNull'd grant pointers drop the row entirely.
 *   - Reading is scoped to the recipient *and* the school, even though the
 *     recipient pointer alone would already be specific to one person.
 *   - Dismissing is scoped to the recipient AND the `UNLOCK_GRANTED` type, so a
 *     valid id never reaches into another user's row or another notification
 *     type through this action.
 */

const SCHOOL_ID = "school-1";
const TEACHER_ID = "teacher-1";

type GrantRow = {
  scope: "ARAL_WEEKLY_ATTENDANCE" | "TERM_GRADES" | "MONTHLY_READING_LEVEL";
  targetKey: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type NotificationRow = {
  id: string;
  unlockGrantId?: string | null;
  schoolUnlockGrantId?: string | null;
  unlockGrant: GrantRow | null;
  schoolUnlockGrant: GrantRow | null;
};

function grant(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    scope: "MONTHLY_READING_LEVEL",
    targetKey: "2026-08-01",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  };
}

let feedRows: NotificationRow[] = [];
const feedArgs: { where: Record<string, unknown>; take?: number; orderBy?: unknown }[] = [];
const updateArgs: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];

const notificationFindMany = vi.fn(
  async (args: { where: Record<string, unknown>; take?: number }) => {
    feedArgs.push(args);
    return feedRows.slice(0, args.take ?? feedRows.length);
  }
);

const notificationUpdateMany = vi.fn(
  async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    updateArgs.push(args);
    const ids = (args.where.id as { in: string[] }).in;
    return { count: ids.length };
  }
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findMany: (...args: unknown[]) => notificationFindMany(...(args as [never])),
      updateMany: (...args: unknown[]) => notificationUpdateMany(...(args as [never])),
      create: vi.fn(),
    },
    learner: { findMany: vi.fn() },
  },
}));

let currentUser: { id: string; role: string; schoolId: string | null } = {
  id: TEACHER_ID,
  role: "TEACHER",
  schoolId: SCHOOL_ID,
};

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => currentUser,
}));

const { getUnreadUnlockGrants } = await import("@/lib/notifications");
const { fetchUnlockAlerts, dismissUnlockAlerts } = await import("@/lib/actions/notifications");

beforeEach(() => {
  vi.clearAllMocks();
  feedRows = [];
  feedArgs.length = 0;
  updateArgs.length = 0;
  currentUser = { id: TEACHER_ID, role: "TEACHER", schoolId: SCHOOL_ID };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getUnreadUnlockGrants", () => {
  it("scopes the feed read to this recipient AND this school", async () => {
    await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(feedArgs).toHaveLength(1);
    expect(feedArgs[0].where).toEqual({
      recipientId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      type: "UNLOCK_GRANTED",
      readAt: null,
    });
  });

  it("drops a revoked grant", async () => {
    feedRows = [
      { id: "n-1", unlockGrant: grant({ revokedAt: new Date() }), schoolUnlockGrant: null },
    ];

    const alerts = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alerts).toEqual([]);
  });

  it("drops an expired grant", async () => {
    feedRows = [
      {
        id: "n-1",
        unlockGrant: grant({ expiresAt: new Date(Date.now() - 1000) }),
        schoolUnlockGrant: null,
      },
    ];

    const alerts = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alerts).toEqual([]);
  });

  it("drops a notification whose grant pointer was SetNull'd", async () => {
    feedRows = [{ id: "n-1", unlockGrant: null, schoolUnlockGrant: null }];

    const alerts = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alerts).toEqual([]);
  });

  it("renders the expiry in Manila time, not the server's own UTC day", async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      // 2030-09-07T20:00:00Z is already September 8, 04:00 in Asia/Manila
      // (UTC+8) — and still safely in the future so the grant reads as live. A
      // server running in UTC (as this app's lambdas do) must still report the
      // Manila calendar day, not its own.
      feedRows = [
        {
          id: "n-1",
          unlockGrant: grant({
            scope: "MONTHLY_READING_LEVEL",
            targetKey: "2026-08-01",
            expiresAt: new Date("2030-09-07T20:00:00Z"),
          }),
          schoolUnlockGrant: null,
        },
      ];

      const [alert] = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

      expect(alert.description).toContain("September 8, 2030");
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("composes the monthly reading level window for a personal grant", async () => {
    feedRows = [
      {
        id: "n-1",
        unlockGrant: grant({
          scope: "MONTHLY_READING_LEVEL",
          targetKey: "2026-08-01",
          expiresAt: new Date(2030, 8, 7),
        }),
        schoolUnlockGrant: null,
      },
    ];

    const [alert] = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alert.title).toBe("Monthly reading level reopened.");
    expect(alert.description).toBe("August 2026. Open until September 7, 2030.");
    expect(alert.href).toBe("/teacher/aral");
  });

  it("composes the weekly attendance window from the Monday key", async () => {
    feedRows = [
      {
        id: "n-1",
        unlockGrant: grant({
          scope: "ARAL_WEEKLY_ATTENDANCE",
          targetKey: "2026-08-10",
          expiresAt: new Date(2030, 7, 24),
        }),
        schoolUnlockGrant: null,
      },
    ];

    const [alert] = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alert.title).toBe("Weekly ARAL attendance reopened.");
    expect(alert.description).toBe("August 10 – August 16, 2026. Open until August 24, 2030.");
  });

  it("composes the term label for a term grades grant", async () => {
    feedRows = [
      {
        id: "n-1",
        unlockGrant: grant({
          scope: "TERM_GRADES",
          targetKey: "SECOND",
          expiresAt: new Date(2030, 9, 1),
        }),
        schoolUnlockGrant: null,
      },
    ];

    const [alert] = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alert.title).toBe("Term grade sheet reopened.");
    expect(alert.description).toBe("Second Term. Open until October 1, 2030.");
  });

  it("says the window applies to everyone at the school for a school-wide grant", async () => {
    feedRows = [
      {
        id: "n-1",
        unlockGrant: null,
        schoolUnlockGrant: grant({
          scope: "MONTHLY_READING_LEVEL",
          targetKey: "2026-08-01",
          expiresAt: new Date(2030, 8, 7),
        }),
      },
    ];

    const [alert] = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alert.description).toBe(
      "August 2026, for everyone at your school. Open until September 7, 2030."
    );
  });

  it("composes from the personal grant deterministically when both pointers are somehow set (belt and suspenders)", async () => {
    // The SQL CHECK guarantees this cannot happen; `unlockGrant` still wins
    // deterministically if it ever did.
    feedRows = [
      {
        id: "n-1",
        unlockGrant: grant({ scope: "TERM_GRADES", targetKey: "FIRST" }),
        schoolUnlockGrant: grant({ scope: "MONTHLY_READING_LEVEL", targetKey: "2026-08-01" }),
      },
    ];

    const [alert] = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alert.title).toBe("Term grade sheet reopened.");
  });

  it("collapses two notifications for the same live grant into one alert, keeping the newest", async () => {
    // Rows arrive newest-first, same as the real `orderBy: { createdAt: "desc" }`.
    feedRows = [
      {
        id: "n-new",
        unlockGrantId: "grant-1",
        unlockGrant: grant({ targetKey: "2026-08-01" }),
        schoolUnlockGrant: null,
      },
      {
        id: "n-old",
        unlockGrantId: "grant-1",
        unlockGrant: grant({ targetKey: "2026-08-01" }),
        schoolUnlockGrant: null,
      },
    ];

    const alerts = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe("n-new");
  });

  it("marks the older duplicate read so dismissing the surfaced alert cannot leave it unread", async () => {
    feedRows = [
      {
        id: "n-new",
        unlockGrantId: "grant-1",
        unlockGrant: grant({ targetKey: "2026-08-01" }),
        schoolUnlockGrant: null,
      },
      {
        id: "n-old",
        unlockGrantId: "grant-1",
        unlockGrant: grant({ targetKey: "2026-08-01" }),
        schoolUnlockGrant: null,
      },
    ];

    await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(updateArgs).toHaveLength(1);
    expect(updateArgs[0].where).toEqual({
      id: { in: ["n-old"] },
      recipientId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      type: "UNLOCK_GRANTED",
      readAt: null,
    });
  });

  it("marks a dead row (revoked/expired/SetNull) read instead of leaving it stuck in the window forever", async () => {
    feedRows = [
      { id: "n-dead", unlockGrant: grant({ revokedAt: new Date() }), schoolUnlockGrant: null },
    ];

    const alerts = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alerts).toEqual([]);
    expect(updateArgs).toHaveLength(1);
    expect(updateArgs[0].where).toMatchObject({
      id: { in: ["n-dead"] },
      recipientId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      type: "UNLOCK_GRANTED",
    });
  });

  it("does not throw the read when the stale-row cleanup write fails", async () => {
    feedRows = [
      { id: "n-dead", unlockGrant: grant({ revokedAt: new Date() }), schoolUnlockGrant: null },
    ];
    notificationUpdateMany.mockRejectedValueOnce(new Error("db down"));

    const alerts = await getUnreadUnlockGrants({ id: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(alerts).toEqual([]);
  });
});

describe("fetchUnlockAlerts", () => {
  it("returns [] and issues no query for a Super Admin caller", async () => {
    currentUser = { id: "admin-1", role: "SUPER_ADMIN", schoolId: null };

    const alerts = await fetchUnlockAlerts();

    expect(alerts).toEqual([]);
    expect(notificationFindMany).not.toHaveBeenCalled();
  });

  it("returns the teacher's live alerts", async () => {
    feedRows = [{ id: "n-1", unlockGrant: grant(), schoolUnlockGrant: null }];

    const alerts = await fetchUnlockAlerts();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe("n-1");
  });
});

const NOTIFICATION_ID_1 = "11111111-1111-1111-1111-111111111111";
const NOTIFICATION_ID_2 = "22222222-2222-2222-2222-222222222222";

describe("dismissUnlockAlerts", () => {
  it("issues an updateMany scoped to this recipient and UNLOCK_GRANTED, so it cannot clear another user's row", async () => {
    const result = await dismissUnlockAlerts([NOTIFICATION_ID_1, NOTIFICATION_ID_2]);

    expect(result).toEqual({ ok: true, data: { dismissed: 2 } });
    expect(updateArgs).toHaveLength(1);
    expect(updateArgs[0].where).toEqual({
      id: { in: [NOTIFICATION_ID_1, NOTIFICATION_ID_2] },
      recipientId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      type: "UNLOCK_GRANTED",
      readAt: null,
    });
  });

  it("rejects an empty id list without touching the table", async () => {
    const result = await dismissUnlockAlerts([]);

    expect(result.ok).toBe(false);
    expect(notificationUpdateMany).not.toHaveBeenCalled();
  });
});
