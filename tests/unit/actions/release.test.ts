import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The release channel's four server actions (§2 of the ten concerns).
 *
 * Only Prisma, the session and the shared read-marker are mocked. The release
 * array is mocked too, but to a fixed shape rather than the committed one, so
 * these tests say what the actions do with ANY announcing release instead of
 * breaking every time a release is added.
 *
 * Two departures from the approved plan are pinned here, because both are what
 * make the bell half of the spec work at all:
 *
 *   - The duplicate check looks at UNREAD rows only. The plan's version matched
 *     any release row, read or not, so once a user had ever had one, no later
 *     release could write them another — the bell would go quiet for them
 *     forever after the first.
 *   - `fetchReleaseAlert` / `dismissReleaseAlert` exist. The plan wrote the bell
 *     row and nothing ever read it: the teacher and School Head bells are fed
 *     only what their layouts pass, and no layout passed notification rows.
 */

const mockUser = vi.fn();
const mockNotificationFindFirst = vi.fn();
const mockNotificationCreate = vi.fn();
const mockUserUpdate = vi.fn();
const mockMarkRead = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => mockUser(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findFirst: (...a: unknown[]) => mockNotificationFindFirst(...a),
      create: (...a: unknown[]) => mockNotificationCreate(...a),
    },
    user: {
      update: (...a: unknown[]) => mockUserUpdate(...a),
    },
  },
}));

vi.mock("@/lib/notifications", () => ({
  markNotificationsRead: (...a: unknown[]) => mockMarkRead(...a),
}));

let announce = true;
vi.mock("@/lib/releases", () => ({
  APP_VERSION: "1.1.0",
  latestRelease: () => ({
    version: "1.1.0",
    date: "2026-09-11",
    title: "A test release",
    announce,
    fixes: ["Something was fixed"],
  }),
}));

import {
  acknowledgeRelease,
  announceRelease,
  dismissReleaseAlert,
  fetchReleaseAlert,
} from "@/lib/actions/release";

const TEACHER = {
  id: "u1",
  schoolId: "s1",
  role: "TEACHER",
  lastSeenReleaseVersion: null as string | null,
};
const ROW_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  announce = true;
  mockUser.mockResolvedValue(TEACHER);
  mockNotificationFindFirst.mockResolvedValue(null);
  mockNotificationCreate.mockResolvedValue({ id: "n1" });
  mockUserUpdate.mockResolvedValue({});
  mockMarkRead.mockResolvedValue(1);
});

describe("announceRelease", () => {
  it("writes one bell row for a user who has not seen this release", async () => {
    const res = await announceRelease();

    expect(res.ok).toBe(true);
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    const arg = mockNotificationCreate.mock.calls[0][0] as {
      data: {
        recipientId: string;
        schoolId: string;
        type: string;
        learnerIds: string[];
        actorId: string | null;
      };
    };
    expect(arg.data.recipientId).toBe("u1");
    expect(arg.data.schoolId).toBe("s1");
    expect(arg.data.type).toBe("RELEASE_PUBLISHED");
    // No learners are involved in a release; the column is non-nullable.
    expect(arg.data.learnerIds).toEqual([]);
    // Published by the project, not by a person in this school.
    expect(arg.data.actorId).toBeNull();
  });

  it("writes nothing when the user already acknowledged this version", async () => {
    mockUser.mockResolvedValue({ ...TEACHER, lastSeenReleaseVersion: "1.1.0" });

    expect((await announceRelease()).ok).toBe(true);
    expect(mockNotificationFindFirst).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("writes nothing for a release that does not announce", async () => {
    // `announce: false` is visible at /releases and in the sidebar, and
    // interrupts nobody. That is the whole purpose of the flag.
    announce = false;

    expect((await announceRelease()).ok).toBe(true);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("is idempotent — a second mount does not produce a second row", async () => {
    mockNotificationFindFirst.mockResolvedValue({ id: "existing" });

    expect((await announceRelease()).ok).toBe(true);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("checks for an UNREAD row, so a later release can still write one", async () => {
    await announceRelease();

    const where = (
      mockNotificationFindFirst.mock.calls[0][0] as { where: Record<string, unknown> }
    ).where;
    expect(where).toMatchObject({
      recipientId: "u1",
      schoolId: "s1",
      type: "RELEASE_PUBLISHED",
      readAt: null,
    });
  });

  it("writes nothing for a user with no school", async () => {
    // `Notification.schoolId` is non-nullable. A Super Admin still sees the
    // modal, which needs no row.
    mockUser.mockResolvedValue({ ...TEACHER, schoolId: null });

    expect((await announceRelease()).ok).toBe(true);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("degrades rather than failing when the write throws", async () => {
    mockNotificationCreate.mockRejectedValue(new Error("pool timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    // A courtesy bell row is not worth surfacing an error over.
    expect((await announceRelease()).ok).toBe(true);
  });
});

describe("acknowledgeRelease", () => {
  it("stamps the current version on the caller", async () => {
    expect((await acknowledgeRelease()).ok).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastSeenReleaseVersion: "1.1.0" },
    });
  });

  it("is idempotent — stamping twice ends in the same state as once", async () => {
    await acknowledgeRelease();
    await acknowledgeRelease();

    for (const call of mockUserUpdate.mock.calls) {
      expect(
        (call[0] as { data: { lastSeenReleaseVersion: string } }).data
          .lastSeenReleaseVersion
      ).toBe("1.1.0");
    }
  });

  it("reports failure when the stamp cannot be written", async () => {
    mockUserUpdate.mockRejectedValue(new Error("pool timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Unlike the bell row, this matters: without the stamp the user is
    // interrupted again on the next page, so they must be told it did not stick.
    expect((await acknowledgeRelease()).ok).toBe(false);
  });
});

describe("fetchReleaseAlert", () => {
  it("returns nothing when there is no unread release row", async () => {
    expect(await fetchReleaseAlert()).toBeNull();
  });

  it("composes the bell row at read time, linking to the history", async () => {
    mockNotificationFindFirst.mockResolvedValue({ id: ROW_ID });

    const alert = await fetchReleaseAlert();

    expect(alert).toEqual({
      id: ROW_ID,
      title: "What's new in LITRACK 1.1.0",
      description: "A test release",
      href: "/releases",
      // Not violet: violet is reserved for ARAL across the app.
      tone: "amber",
    });
  });

  it("reads only this user's unread release rows, school-scoped", async () => {
    await fetchReleaseAlert();

    expect(
      (mockNotificationFindFirst.mock.calls[0][0] as { where: unknown }).where
    ).toEqual({
      recipientId: "u1",
      schoolId: "s1",
      type: "RELEASE_PUBLISHED",
      readAt: null,
    });
  });

  it("returns nothing for a user with no school, without querying", async () => {
    mockUser.mockResolvedValue({ ...TEACHER, schoolId: null });

    expect(await fetchReleaseAlert()).toBeNull();
    expect(mockNotificationFindFirst).not.toHaveBeenCalled();
  });

  it("returns nothing rather than throwing when the read fails", async () => {
    mockNotificationFindFirst.mockRejectedValue(new Error("pool timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    // A bell that cannot load must not break the page it sits on.
    expect(await fetchReleaseAlert()).toBeNull();
  });
});

describe("dismissReleaseAlert", () => {
  it("marks the row read, scoped to the caller", async () => {
    expect(await dismissReleaseAlert(ROW_ID)).toEqual({ ok: true });
    expect(mockMarkRead).toHaveBeenCalledWith({
      recipientId: "u1",
      schoolId: "s1",
      ids: [ROW_ID],
    });
  });

  it("refuses an id that is not a uuid, before touching the database", async () => {
    // Ids arrive from the client and are treated as such.
    expect((await dismissReleaseAlert("not-an-id")).ok).toBe(false);
    expect(mockMarkRead).not.toHaveBeenCalled();
  });
});
