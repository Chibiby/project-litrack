import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * The in-app notification store behind the ARAL assignment popup.
 *
 * Three contracts live here, and the popup is wrong in a different way if any of
 * them slips:
 *
 *   - The row stores ids, never names. The sentence a tutor reads is composed at
 *     read time from the learners as they are *now*, so a renamed, unenrolled or
 *     archived learner leaves no stale text behind — and no learner PII is
 *     duplicated into a second table for the Data Privacy Act to worry about.
 *   - Writing is best-effort. The designation it announces has already committed,
 *     so a failed insert must stay quiet rather than report a failure that did
 *     not happen.
 *   - Reading and clearing are scoped to the recipient *and* the school. The ids
 *     arrive from the client; one teacher holding a valid id must still not be
 *     able to read or clear another's feed.
 */

type ActorRow = {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Both of these decide the honorific printed in front of the name. */
  role: "TEACHER" | "SCHOOL_HEAD" | "SUPER_ADMIN";
  teacherProfile: { designation: string | null } | null;
};

type NotificationRow = {
  id: string;
  learnerIds: string[];
  actor: ActorRow | null;
};

type LearnerRow = {
  id: string;
  fullName: string;
  gradeLevelId: string;
  schoolId: string;
  deletedAt: Date | null;
  archivedAt: Date | null;
  isAralLearner: boolean;
};

const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";
const TUTOR_ID = "tutor-1";
const ACTOR_ID = "actor-1";

function learner(overrides: Partial<LearnerRow> & { id: string }): LearnerRow {
  return {
    fullName: `Learner ${overrides.id}`,
    gradeLevelId: "grade-g3",
    schoolId: SCHOOL_ID,
    deletedAt: null,
    archivedAt: null,
    isAralLearner: true,
    ...overrides,
  };
}

/**
 * The person who made the designation, as the feed selects them. Defaults to a
 * DepEd teacher — the ordinary case, and the one "Teacher" is the honorific for.
 */
function actor(overrides: Partial<ActorRow> = {}): ActorRow {
  return {
    fullName: "Marivic Santos",
    firstName: null,
    lastName: null,
    role: "TEACHER",
    teacherProfile: null,
    ...overrides,
  };
}

/** What the feed read will find, per test. */
let feedRows: NotificationRow[] = [];
/** The school's learners, for the name lookup the feed does second. */
let learners: LearnerRow[] = [];
/** Set to make the insert blow up the way a missing table would. */
let createThrows: Error | null = null;

const creates: { data: Record<string, unknown> }[] = [];
const feedArgs: { where: Record<string, unknown>; take?: number; orderBy?: unknown }[] = [];
const learnerArgs: { where: Record<string, unknown> }[] = [];
const updateArgs: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];

const notificationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
  if (createThrows) throw createThrows;
  creates.push(args);
  return { id: "notification-1" };
});

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

/**
 * Honours every filter the real query carries rather than echoing `id.in` back —
 * a permissive fake would pass the cross-tenant and archived-learner tests below
 * without the query actually saying so.
 */
const learnerFindMany = vi.fn(
  async (args: {
    where: {
      id: { in: string[] };
      schoolId: string;
      deletedAt: null;
      archivedAt: null;
      isAralLearner: boolean;
    };
  }) => {
    learnerArgs.push(args);
    const { id, schoolId, isAralLearner } = args.where;
    return learners
      .filter(
        (l) =>
          id.in.includes(l.id) &&
          l.schoolId === schoolId &&
          l.deletedAt === null &&
          l.archivedAt === null &&
          l.isAralLearner === isAralLearner
      )
      .map((l) => ({
        id: l.id,
        fullName: l.fullName,
        gradeLevelId: l.gradeLevelId,
      }));
  }
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      create: (...args: unknown[]) => notificationCreate(...(args as [never])),
      findMany: (...args: unknown[]) => notificationFindMany(...(args as [never])),
      updateMany: (...args: unknown[]) => notificationUpdateMany(...(args as [never])),
    },
    learner: {
      findMany: (...args: unknown[]) => learnerFindMany(...(args as [never])),
    },
  },
}));

const {
  notifyAralAssigned,
  getUnreadAralAssignments,
  markNotificationsRead,
} = await import("@/lib/notifications");

beforeEach(() => {
  vi.clearAllMocks();
  feedRows = [];
  learners = [];
  createThrows = null;
  creates.length = 0;
  feedArgs.length = 0;
  learnerArgs.length = 0;
  updateArgs.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifyAralAssigned", () => {
  it("addresses one row to the tutor, carrying ids and nothing else", async () => {
    await notifyAralAssigned({
      schoolId: SCHOOL_ID,
      recipientId: TUTOR_ID,
      actorId: ACTOR_ID,
      learnerIds: ["l-1", "l-2"],
    });

    expect(creates).toHaveLength(1);
    // Ids only. A name here would duplicate learner PII into a table nothing
    // keeps in step with the roster.
    expect(creates[0].data).toEqual({
      schoolId: SCHOOL_ID,
      recipientId: TUTOR_ID,
      actorId: ACTOR_ID,
      type: "ARAL_ASSIGNED",
      learnerIds: ["l-1", "l-2"],
    });
  });

  it("says nothing when a teacher assigns learners to themselves", async () => {
    await notifyAralAssigned({
      schoolId: SCHOOL_ID,
      recipientId: TUTOR_ID,
      actorId: TUTOR_ID,
      learnerIds: ["l-1"],
    });

    // Every caller passes the designation through unconditionally, so the guard
    // has to be here — otherwise a teacher enrolling their own roster gets a
    // popup telling them what they just did.
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("says nothing when the selection turned out to be empty", async () => {
    await notifyAralAssigned({
      schoolId: SCHOOL_ID,
      recipientId: TUTOR_ID,
      actorId: ACTOR_ID,
      learnerIds: [],
    });

    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("swallows a failed insert instead of failing the assignment", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    createThrows = new Error('relation "Notification" does not exist');

    // The designation has already committed by the time this runs — the same
    // reason writeAudit never throws. This is exactly the unapplied-migration
    // case: enrolment keeps working, only the courtesy message is lost.
    await expect(
      notifyAralAssigned({
        schoolId: SCHOOL_ID,
        recipientId: TUTOR_ID,
        actorId: ACTOR_ID,
        learnerIds: ["l-1"],
      })
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalled();
  });
});

describe("getUnreadAralAssignments", () => {
  it("reads only this recipient's unread ARAL rows, in this school", async () => {
    await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    expect(feedArgs).toHaveLength(1);
    // The recipient pointer alone would do today; the school is on the query
    // anyway, so the next edit here cannot become a leak.
    expect(feedArgs[0].where).toEqual({
      recipientId: TUTOR_ID,
      schoolId: SCHOOL_ID,
      type: "ARAL_ASSIGNED",
      readAt: null,
    });
    expect(feedArgs[0].take).toBe(20);
    expect(feedArgs[0].orderBy).toEqual({ createdAt: "desc" });
  });

  it("skips the name lookup entirely when the feed is empty", async () => {
    const alerts = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    expect(alerts).toEqual([]);
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("names the actor, lists the learners, and deep-links their grade", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["l-1", "l-2"],
        actor: actor({ firstName: "Marivic", lastName: "Santos" }),
      },
    ];
    learners = [
      learner({ id: "l-1", fullName: "Ana Cruz", gradeLevelId: "grade-g3" }),
      learner({ id: "l-2", fullName: "Ben Dela Cruz", gradeLevelId: "grade-g3" }),
    ];

    const [alert] = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    expect(alert.id).toBe("n-1");
    expect(alert.title).toBe("Teacher Marivic Santos assigned you 2 ARAL learners.");
    expect(alert.description).toBe("Ana Cruz and Ben Dela Cruz");
    // One grade, so the popup can land the tutor on the grid they will use.
    expect(alert.href).toBe("/teacher/aral/grade-g3");
  });

  it("says an ARAL learner, singular, for a selection of one", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["l-1"],
        actor: actor(),
      },
    ];
    learners = [learner({ id: "l-1", fullName: "Ana Cruz" })];

    const [alert] = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    expect(alert.title).toBe("Teacher Marivic Santos assigned you an ARAL learner.");
    expect(alert.description).toBe("Ana Cruz");
  });

  it("counts the tail past three names instead of listing everyone", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["l-1", "l-2", "l-3", "l-4", "l-5"],
        actor: actor(),
      },
    ];
    learners = ["Ana", "Ben", "Cita", "Dodo", "Elmo"].map((n, i) =>
      learner({ id: `l-${i + 1}`, fullName: n })
    );

    const [alert] = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    expect(alert.description).toBe("Ana, Ben, Cita and 2 more");
    expect(alert.title).toBe("Teacher Marivic Santos assigned you 5 ARAL learners.");
  });

  it("falls back to the ARAL index when the learners span grades", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["l-1", "l-2"],
        actor: actor(),
      },
    ];
    learners = [
      learner({ id: "l-1", gradeLevelId: "grade-g3" }),
      learner({ id: "l-2", gradeLevelId: "grade-g4" }),
    ];

    const [alert] = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    // No single grid to open, so the tutor picks — better than guessing one and
    // hiding the other half of the assignment.
    expect(alert.href).toBe("/teacher/aral");
  });

  it("drops a learner who has left the program, but keeps the count honest", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["stays", "archived", "unenrolled", "gone"],
        actor: actor(),
      },
    ];
    learners = [
      learner({ id: "stays", fullName: "Ana Cruz" }),
      learner({ id: "archived", fullName: "Ben Cruz", archivedAt: new Date() }),
      learner({ id: "unenrolled", fullName: "Cita Cruz", isAralLearner: false }),
      learner({ id: "gone", fullName: "Dodo Cruz", deletedAt: new Date() }),
      // Same id space, another school — must not be reachable from this feed.
      learner({ id: "stays", fullName: "Someone Else", schoolId: OTHER_SCHOOL_ID }),
    ];

    const [alert] = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    // Only the surviving learner is named, and only ours: three of the four are
    // no longer somewhere this tutor could be sent.
    expect(alert.description).toBe("Ana Cruz");
    expect(alert.title).toBe("Teacher Marivic Santos assigned you an ARAL learner.");
    expect(learnerArgs[0].where).toMatchObject({
      schoolId: SCHOOL_ID,
      deletedAt: null,
      archivedAt: null,
      isAralLearner: true,
    });
  });

  it("counts the row rather than naming nobody when every learner is gone", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["gone-1", "gone-2"],
        actor: actor(),
      },
    ];

    const [alert] = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    // A silent empty sentence would read as a bug; "2 learners" is at least true.
    expect(alert.description).toBe("2 learners");
    expect(alert.title).toBe("Teacher Marivic Santos assigned you 2 ARAL learners.");
    expect(alert.href).toBe("/teacher/aral");
  });

  it("builds the actor's name from parts, then gives up gracefully", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["l-1"],
        actor: actor({ fullName: "   ", firstName: "Jun", lastName: "Dela Cruz" }),
      },
      { id: "n-2", learnerIds: ["l-1"], actor: null },
    ];
    learners = [learner({ id: "l-1", fullName: "Ana Cruz" })];

    const alerts = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    // A blank fullName is not a name — School Heads carry synthetic accounts and
    // some legacy rows have only the parts.
    expect(alerts[0].title).toBe("Teacher Jun Dela Cruz assigned you an ARAL learner.");
    // Nobody to name at all: the message still has to say something true, and a
    // designation a teacher did not make came from above them.
    expect(alerts[1].title).toBe("Your School Head assigned you an ARAL learner.");
  });

  it("titles the actor by what they are, not Teacher for everyone", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["l-1"],
        actor: actor({ fullName: "Ana Reyes", role: "SCHOOL_HEAD" }),
      },
      {
        id: "n-2",
        learnerIds: ["l-1"],
        actor: actor({
          fullName: "Brandanlee Hugos",
          teacherProfile: { designation: ARAL_VOLUNTEER_DESIGNATION },
        }),
      },
    ];
    learners = [learner({ id: "l-1", fullName: "Ana Cruz" })];

    const alerts = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    // Calling a School Head "Teacher" is a demotion in print, and a Non-DepEd
    // ARAL Volunteer holds the TEACHER role without being a teacher. The
    // honorific follows the person, which is how these two address each other.
    expect(alerts[0].title).toBe("School Head Ana Reyes assigned you an ARAL learner.");
    expect(alerts[1].title).toBe(
      "ARAL Volunteer Brandanlee Hugos assigned you an ARAL learner."
    );
  });

  it("lets the honorific stand alone when the actor has no name at all", async () => {
    feedRows = [
      {
        id: "n-1",
        learnerIds: ["l-1"],
        actor: actor({ fullName: null, role: "SCHOOL_HEAD" }),
      },
    ];
    learners = [learner({ id: "l-1", fullName: "Ana Cruz" })];

    const [alert] = await getUnreadAralAssignments({ id: TUTOR_ID, schoolId: SCHOOL_ID });

    // Nameless but present: the row knows who acted, so say what they are rather
    // than falling through to the guess kept for a missing actor.
    expect(alert.title).toBe("School Head assigned you an ARAL learner.");
  });
});

describe("markNotificationsRead", () => {
  it("clears only rows this recipient owns, in this school, still unread", async () => {
    const count = await markNotificationsRead({
      recipientId: TUTOR_ID,
      schoolId: SCHOOL_ID,
      ids: ["n-1", "n-2"],
    });

    expect(count).toBe(2);
    expect(updateArgs).toHaveLength(1);
    // The ids come from the client. Without the recipient and school legs, a
    // valid id from anywhere would clear somebody else's popup.
    expect(updateArgs[0].where).toEqual({
      id: { in: ["n-1", "n-2"] },
      recipientId: TUTOR_ID,
      schoolId: SCHOOL_ID,
      readAt: null,
    });
    expect(updateArgs[0].data.readAt).toBeInstanceOf(Date);
  });

  it("does not touch the table for an empty list", async () => {
    const count = await markNotificationsRead({
      recipientId: TUTOR_ID,
      schoolId: SCHOOL_ID,
      ids: [],
    });

    expect(count).toBe(0);
    expect(notificationUpdateMany).not.toHaveBeenCalled();
  });
});
