import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Action-level coverage for `enrollRosterLearnersToAral` — the write behind the
 * teacher roster's ARAL spark, its bulk "Enroll in ARAL", and the profile
 * dialog's tutor picker. All three send the same shape, so this is the one place
 * the rules live.
 *
 * What is contract here, and so asserted rather than assumed:
 *
 *   - The selection is read through the teacher's own scope AND the school, so a
 *     learner from another tenant or another teacher's roster cannot be enrolled
 *     by id. A partial match fails the whole call with one generic message, which
 *     is what stops the error from telling a prober which of those it was.
 *   - Any teacher at the school may tutor — plantilla or volunteer — but only a
 *     teacher at the school, and a rejected tutor writes nothing at all.
 *   - Enrolling and moving are counted separately, because the caller reports
 *     them separately, and a selection that only moved learners is logged under
 *     the designation action rather than the enrolment one.
 *   - Nothing to do writes nothing: no transaction, no audit row, no notification.
 *
 * Only leaf infrastructure is mocked. The real Zod schema and the real
 * `teacherLearnerScope` run, so the `where` these tests inspect is the one the
 * action would send to Postgres.
 */

const TEACHER_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "22222222-2222-4222-8222-222222222222";
const OUTSIDER_ID = "33333333-3333-4333-8333-333333333333";
const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";

type LearnerRow = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  teacherId: string | null;
  aralTeacherId: string | null;
  isAralLearner: boolean;
  deletedAt: Date | null;
  archivedAt: Date | null;
};

function learner(overrides: Partial<LearnerRow> & { id: string }): LearnerRow {
  return {
    schoolId: SCHOOL_ID,
    gradeLevelId: "grade-g3",
    teacherId: TEACHER_ID,
    aralTeacherId: null,
    isAralLearner: false,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/** The school's learner table for one test. */
let rows: LearnerRow[] = [];
/** Every `where` the action read the selection with. */
let findManyArgs: { where: Record<string, unknown> }[] = [];
/** `updateMany` calls made inside the transaction, in order. */
let updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] =
  [];
/** Whether the named tutor passes the eligibility check. */
let tutorEligible = true;
let profileCompleted = true;

/**
 * Honours `schoolId`, the soft-delete/archive filters and the teacher scope
 * rather than returning rows regardless — a permissive fake would hide exactly
 * the cross-tenant bug these tests exist to catch.
 */
const learnerFindMany = vi.fn(
  async (args: {
    where: {
      id: { in: string[] };
      schoolId: string;
      deletedAt: null;
      archivedAt: null;
      OR?: { teacherId?: string; aralTeacherId?: string }[];
    };
  }) => {
    findManyArgs.push(args);
    const { id, schoolId, OR } = args.where;
    return rows
      .filter(
        (l) =>
          id.in.includes(l.id) &&
          l.schoolId === schoolId &&
          l.deletedAt === null &&
          l.archivedAt === null &&
          (!OR ||
            OR.some(
              (clause) =>
                (clause.teacherId !== undefined &&
                  clause.teacherId === l.teacherId) ||
                (clause.aralTeacherId !== undefined &&
                  clause.aralTeacherId === l.aralTeacherId)
            ))
      )
      .map((l) => ({
        id: l.id,
        gradeLevelId: l.gradeLevelId,
        teacherId: l.teacherId,
        isAralLearner: l.isAralLearner,
        aralTeacherId: l.aralTeacherId,
      }));
  }
);

const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
  cb({
    learner: {
      updateMany: vi.fn(
        async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updates.push(args);
          return { count: 0 };
        }
      ),
    },
  })
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    learner: {
      findMany: (...args: unknown[]) => learnerFindMany(...(args as [never])),
    },
  },
}));

const requireSchoolUser = vi.fn(async () => ({
  id: TEACHER_ID,
  schoolId: SCHOOL_ID,
  role: "TEACHER" as const,
  profileCompleted,
}));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const isEligibleAralTutor = vi.fn(async () => tutorEligible);
vi.mock("@/lib/teachers/aral-tutor", () => ({
  isEligibleAralTutor: (...args: unknown[]) =>
    isEligibleAralTutor(...(args as [])),
}));

const notifyAralAssigned = vi.fn(async () => {});
vi.mock("@/lib/notifications", () => ({
  notifyAralAssigned: (...args: unknown[]) => notifyAralAssigned(...(args as [])),
}));

/** Typed so the audit row can be read back off `.mock.calls` without a cast. */
const writeAudit = vi.fn(
  async (_entry: {
    action: string;
    resourceId: string | null;
    metadata: Record<string, unknown>;
  }) => {}
);
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [never])),
  AUDIT_ACTIONS: {
    LEARNER_ENROLL_ARAL: "LEARNER_ENROLL_ARAL",
    LEARNER_SET_ARAL_TEACHER: "LEARNER_SET_ARAL_TEACHER",
  },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [])),
}));

const revalidateLearnerScoped = vi.fn();
const revalidateSchoolHeadTeachers = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: (...args: unknown[]) =>
    revalidateLearnerScoped(...(args as [])),
  revalidateSchoolHeadTeachers: (...args: unknown[]) =>
    revalidateSchoolHeadTeachers(...(args as [])),
}));

// Imported after the mock factories above are registered.
const { enrollRosterLearnersToAral } = await import("@/lib/actions/learner");

/** Every write path the action can take, for the "wrote nothing" assertions. */
function expectNoWrites() {
  expect(transaction).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
  expect(notifyAralAssigned).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
}

const auditCall = () => writeAudit.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  findManyArgs = [];
  updates = [];
  tutorEligible = true;
  profileCompleted = true;
});

describe("enrollRosterLearnersToAral — the selection it will act on", () => {
  it("reads the selection through both the school and the teacher's scope", async () => {
    rows = [learner({ id: "a" })];
    await enrollRosterLearnersToAral({ learnerIds: ["a"] });

    expect(findManyArgs).toHaveLength(1);
    const where = findManyArgs[0].where;
    expect(where.schoolId).toBe(SCHOOL_ID);
    expect(where.deletedAt).toBeNull();
    expect(where.archivedAt).toBeNull();
    // Adviser OR designated tutor — the same scope the roster lists by, so
    // anything visible there is actionable and nothing else is.
    expect(where.OR).toEqual([
      { teacherId: TEACHER_ID },
      { aralTeacherId: TEACHER_ID },
    ]);
  });

  it("refuses the whole call when one learner belongs to another school", async () => {
    rows = [learner({ id: "mine" }), learner({ id: "theirs", schoolId: OTHER_SCHOOL_ID })];

    const res = await enrollRosterLearnersToAral({
      learnerIds: ["mine", "theirs"],
    });

    // One generic message for "another school's", "not yours", "archived" and
    // "never existed", so a prober cannot tell them apart — and the learner the
    // teacher does hold is not quietly enrolled alongside the refusal.
    expect(res).toEqual({
      ok: false,
      error: "One or more learners are no longer on your roster",
    });
    expectNoWrites();
  });

  it("refuses a learner on neither of the teacher's two axes", async () => {
    rows = [
      learner({ id: "mine" }),
      learner({ id: "somebody-elses", teacherId: OUTSIDER_ID }),
    ];

    const res = await enrollRosterLearnersToAral({
      learnerIds: ["mine", "somebody-elses"],
    });

    expect(res.ok).toBe(false);
    expectNoWrites();
  });

  it("acts on a learner reached only through an ARAL designation", async () => {
    // An ARAL-only teacher advises nothing; the designation is their whole access.
    rows = [
      learner({
        id: "designated",
        teacherId: OUTSIDER_ID,
        aralTeacherId: TEACHER_ID,
        isAralLearner: true,
      }),
    ];

    const res = await enrollRosterLearnersToAral({
      learnerIds: ["designated"],
      aralTeacherId: VOLUNTEER_ID,
    });

    expect(res).toEqual({ ok: true, data: { enrolled: 0, redesignated: 1 } });
  });

  it("counts a repeated id once", async () => {
    rows = [learner({ id: "a" })];

    const res = await enrollRosterLearnersToAral({ learnerIds: ["a", "a", "a"] });

    // Deduped before the length check, or the check itself would reject a
    // double-click as a missing learner.
    expect(res).toEqual({ ok: true, data: { enrolled: 1, redesignated: 0 } });
    expect(findManyArgs[0].where.id).toEqual({ in: ["a"] });
  });

  it("rejects an empty selection before it reads anything", async () => {
    const res = await enrollRosterLearnersToAral({ learnerIds: [] });
    expect(res).toEqual({ ok: false, error: "Select at least one learner" });
    expect(learnerFindMany).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("refuses a teacher who has not completed their profile", async () => {
    profileCompleted = false;
    rows = [learner({ id: "a" })];

    const res = await enrollRosterLearnersToAral({ learnerIds: ["a"] });

    expect(res).toEqual({ ok: false, error: "Complete your profile first" });
    expect(learnerFindMany).not.toHaveBeenCalled();
    expectNoWrites();
  });
});

describe("enrollRosterLearnersToAral — who tutors", () => {
  it("keeps the learners itself when no tutor is named", async () => {
    rows = [learner({ id: "a" }), learner({ id: "b" })];

    const res = await enrollRosterLearnersToAral({ learnerIds: ["a", "b"] });

    expect(res).toEqual({ ok: true, data: { enrolled: 2, redesignated: 0 } });
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: { in: ["a", "b"] } });
    expect(updates[0].data).toMatchObject({
      isAralLearner: true,
      aralTeacherId: TEACHER_ID,
    });
    expect(updates[0].data.aralEnrolledAt).toBeInstanceOf(Date);
    // The notifier is still called, and drops it on the floor: the
    // self-assignment guard lives in `notifyAralAssigned`, covered in
    // tests/unit/notifications.test.ts, so the action does not repeat it.
    expect(notifyAralAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: TEACHER_ID, actorId: TEACHER_ID })
    );
    // And no eligibility round-trip for oneself.
    expect(isEligibleAralTutor).not.toHaveBeenCalled();
  });

  it("accepts any teacher at the school, and tells them", async () => {
    rows = [learner({ id: "a" }), learner({ id: "b" })];

    const res = await enrollRosterLearnersToAral({
      learnerIds: ["a", "b"],
      aralTeacherId: VOLUNTEER_ID,
    });

    expect(res.ok).toBe(true);
    // Eligibility is checked in the tutor's own school, not globally.
    expect(isEligibleAralTutor).toHaveBeenCalledWith(VOLUNTEER_ID, SCHOOL_ID);
    expect(updates[0].data).toMatchObject({ aralTeacherId: VOLUNTEER_ID });
    // One message for the whole gesture, naming who assigned it.
    expect(notifyAralAssigned).toHaveBeenCalledTimes(1);
    expect(notifyAralAssigned).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      recipientId: VOLUNTEER_ID,
      actorId: TEACHER_ID,
      learnerIds: ["a", "b"],
    });
  });

  it("refuses a tutor from outside the school, and writes nothing", async () => {
    tutorEligible = false;
    rows = [learner({ id: "a" })];

    const res = await enrollRosterLearnersToAral({
      learnerIds: ["a"],
      aralTeacherId: OUTSIDER_ID,
    });

    // Same generic wording a missing teacher gets, and the check runs before the
    // learners are even read — so a bad tutor id reveals nothing about either.
    expect(res).toEqual({ ok: false, error: "Teacher not found" });
    expect(learnerFindMany).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("rejects a tutor id that is not a uuid", async () => {
    const res = await enrollRosterLearnersToAral({
      learnerIds: ["a"],
      aralTeacherId: "not-a-uuid",
    });

    expect(res).toEqual({ ok: false, error: "Invalid teacher" });
    expect(isEligibleAralTutor).not.toHaveBeenCalled();
    expectNoWrites();
  });
});

describe("enrollRosterLearnersToAral — enrolling versus moving", () => {
  it("splits a mixed selection into two writes and two counts", async () => {
    rows = [
      learner({ id: "new" }),
      learner({ id: "moving", isAralLearner: true, aralTeacherId: TEACHER_ID }),
      learner({ id: "settled", isAralLearner: true, aralTeacherId: VOLUNTEER_ID }),
    ];

    const res = await enrollRosterLearnersToAral({
      learnerIds: ["new", "moving", "settled"],
      aralTeacherId: VOLUNTEER_ID,
    });

    // "settled" is already with the chosen tutor, so it is in neither write.
    expect(res).toEqual({ ok: true, data: { enrolled: 1, redesignated: 1 } });
    expect(updates).toHaveLength(2);
    expect(updates[0].where).toEqual({ id: { in: ["new"] } });
    expect(updates[0].data).toMatchObject({ isAralLearner: true });
    expect(updates[1].where).toEqual({ id: { in: ["moving"] } });
    // A move changes hands only — it must not restamp the enrolment date.
    expect(updates[1].data).toEqual({ aralTeacherId: VOLUNTEER_ID });
    expect(notifyAralAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ learnerIds: ["new", "moving"] })
    );
  });

  it("logs an enrolment when anybody was enrolled", async () => {
    rows = [
      learner({ id: "new" }),
      learner({ id: "moving", isAralLearner: true, aralTeacherId: TEACHER_ID }),
    ];

    await enrollRosterLearnersToAral({
      learnerIds: ["new", "moving"],
      aralTeacherId: VOLUNTEER_ID,
    });

    const audit = auditCall();
    expect(audit.action).toBe("LEARNER_ENROLL_ARAL");
    // Ids and counts only — never a learner's name or any other PII.
    expect(audit.metadata).toEqual({
      schoolId: SCHOOL_ID,
      source: "roster",
      learnerIds: ["new", "moving"],
      enrolled: 1,
      redesignated: 1,
      aralTeacherId: VOLUNTEER_ID,
      requested: 2,
    });
    // Two learners, so no single resource to point the row at.
    expect(audit.resourceId).toBeNull();
  });

  it("logs a designation change when the selection only changed hands", async () => {
    rows = [learner({ id: "moving", isAralLearner: true, aralTeacherId: TEACHER_ID })];

    const res = await enrollRosterLearnersToAral({
      learnerIds: ["moving"],
      aralTeacherId: VOLUNTEER_ID,
    });

    expect(res).toEqual({ ok: true, data: { enrolled: 0, redesignated: 1 } });
    const audit = auditCall();
    expect(audit.action).toBe("LEARNER_SET_ARAL_TEACHER");
    // One learner, so the row names it.
    expect(audit.resourceId).toBe("moving");
  });

  it("does nothing, loudly, when every learner is already with that tutor", async () => {
    rows = [
      learner({ id: "a", isAralLearner: true, aralTeacherId: VOLUNTEER_ID }),
      learner({ id: "b", isAralLearner: true, aralTeacherId: VOLUNTEER_ID }),
    ];

    const res = await enrollRosterLearnersToAral({
      learnerIds: ["a", "b"],
      aralTeacherId: VOLUNTEER_ID,
    });

    // Reported as a success with two zeroes — the picker turns that into
    // "Already with X — nothing changed" — and the log stays free of a row
    // claiming a change that never happened.
    expect(res).toEqual({ ok: true, data: { enrolled: 0, redesignated: 0 } });
    expectNoWrites();
  });
});

describe("enrollRosterLearnersToAral — what it busts", () => {
  it("busts only the grades the selection actually touched", async () => {
    rows = [
      learner({ id: "moved", gradeLevelId: "grade-g3" }),
      // Already with the chosen tutor, so this grade is untouched.
      learner({
        id: "settled",
        gradeLevelId: "grade-g4",
        isAralLearner: true,
        aralTeacherId: VOLUNTEER_ID,
      }),
    ];

    await enrollRosterLearnersToAral({
      learnerIds: ["moved", "settled"],
      aralTeacherId: VOLUNTEER_ID,
    });

    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/teacher/grade/grade-g3");
    expect(paths).toContain("/teacher/aral/grade-g3");
    expect(paths).not.toContain("/teacher/grade/grade-g4");
    expect(paths).toContain("/teacher/learners");
    expect(paths).toContain("/teacher/aral");
  });

  it("busts the incoming tutor's caches as well as its own", async () => {
    rows = [learner({ id: "a" })];

    await enrollRosterLearnersToAral({
      learnerIds: ["a"],
      aralTeacherId: VOLUNTEER_ID,
    });

    // The tutor's sidebar and metrics are derived from the learners they track.
    expect(revalidateLearnerScoped).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      teacherId: TEACHER_ID,
      teacherShell: true,
    });
    expect(revalidateLearnerScoped).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      aralTeacherId: VOLUNTEER_ID,
      teacherShell: true,
    });
  });

  it("busts the outgoing tutor's caches too", async () => {
    rows = [
      learner({
        id: "moving",
        isAralLearner: true,
        aralTeacherId: OUTSIDER_ID,
        // Reached through the adviser axis, since the tutor is somebody else.
        teacherId: TEACHER_ID,
      }),
    ];

    await enrollRosterLearnersToAral({
      learnerIds: ["moving"],
      aralTeacherId: VOLUNTEER_ID,
    });

    // The teacher who loses the learner sees a stale ARAL list otherwise.
    expect(revalidateLearnerScoped).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      aralTeacherId: OUTSIDER_ID,
      teacherShell: true,
    });
  });
});
