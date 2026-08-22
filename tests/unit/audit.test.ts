import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `writeAudit` dispatches its insert through `next/server`'s `after()` so the
 * database round trip lands past the response. These tests pin the three things
 * that make that safe:
 *
 *  - the *call* is same-tick (only the insert is deferred), so `await
 *    writeAudit(...)` call sites keep their ordering;
 *  - `after()` refusing (it throws three different ways, and queues nothing when
 *    it does) falls back to an inline write instead of dropping the row;
 *  - the never-throws contract holds on both paths.
 */

const auditLogCreate = vi.fn(async (_args: unknown) => ({ id: "audit-row" }));
const auditLogCreateMany = vi.fn(async (_args: unknown) => ({ count: 0 }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...(args as [never])),
      createMany: (...args: unknown[]) => auditLogCreateMany(...(args as [never])),
    },
  },
}));

type AfterTask = () => Promise<void> | void;

/** Tasks handed to `after()`, so a test can decide when (or whether) they run. */
let afterTasks: AfterTask[] = [];
/** Set to make `after()` refuse, the way it does outside a request scope. */
let afterRefusal: Error | null = null;

vi.mock("next/server", () => ({
  after: (task: AfterTask) => {
    if (afterRefusal) throw afterRefusal;
    afterTasks.push(task);
  },
}));

// Imported after the mock factories above are registered.
const { writeAudit, writeAuditMany, AUDIT_ACTIONS } = await import("@/lib/audit");

/** Reproduces a Next error object, including the __NEXT_ERROR_CODE marker. */
function nextError(code: string, message: string) {
  const err = new Error(message);
  Object.defineProperty(err, "__NEXT_ERROR_CODE", { value: code, enumerable: false });
  return err;
}

const E468 = nextError(
  "E468",
  "`after` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context"
);
const E91 = nextError(
  "E91",
  "`after()` will not work correctly, because `waitUntil` is not available in the current environment."
);
const E50 = nextError("E50", "`after()`: Argument must be a promise or a function");

const ENTRY = {
  userId: "user-1",
  schoolId: "school-1",
  action: AUDIT_ACTIONS.LEARNER_DELETE,
  resource: "Learner",
  resourceId: "learner-1",
  metadata: { schoolId: "school-1", learnerId: "learner-1" },
};

/** Run every queued `after()` task, as Next does once the response is flushed. */
async function flushAfterTasks() {
  const tasks = afterTasks;
  afterTasks = [];
  for (const task of tasks) await task();
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks = [];
  afterRefusal = null;
  auditLogCreate.mockResolvedValue({ id: "audit-row" });
  auditLogCreateMany.mockResolvedValue({ count: 0 });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("writeAudit — deferred path", () => {
  it("dispatches same-tick but does not insert before the caller resolves", async () => {
    const pending = writeAudit(ENTRY);

    // The task is queued synchronously: by the time an action's promise settles,
    // writeAudit has been called and the work is registered.
    expect(afterTasks).toHaveLength(1);
    expect(auditLogCreate).not.toHaveBeenCalled();

    await pending;
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("writes exactly one row, once the deferred task runs", async () => {
    await writeAudit(ENTRY);
    await flushAfterTasks();

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        schoolId: "school-1",
        action: "LEARNER_DELETE",
        resource: "Learner",
        resourceId: "learner-1",
        metadata: { schoolId: "school-1", learnerId: "learner-1" },
      },
    });
  });

  it("defaults the optional columns to null and omits absent metadata", async () => {
    await writeAudit({ action: AUDIT_ACTIONS.LOGOUT, resource: "Session" });
    await flushAfterTasks();

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: null,
        schoolId: null,
        action: "LOGOUT",
        resource: "Session",
        resourceId: null,
        metadata: undefined,
      },
    });
  });

  it("swallows and logs an insert failure inside the deferred task", async () => {
    auditLogCreate.mockRejectedValue(new Error("P2024 pool timeout"));

    await expect(writeAudit(ENTRY)).resolves.toBeUndefined();
    // The task must not reject either, or Next's onTaskError would fire.
    await expect(flushAfterTasks()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("[audit] write failed:", expect.any(Error));
  });
});

describe("writeAudit — fallback path", () => {
  it.each([
    ["E468 (no request scope)", E468],
    ["E91 (waitUntil unavailable)", E91],
    ["E50 (bad task argument)", E50],
  ])("falls back to an inline write when after() throws %s", async (_label, refusal) => {
    afterRefusal = refusal;

    await expect(writeAudit(ENTRY)).resolves.toBeUndefined();

    // after() queues nothing when it throws, so there is no second write.
    expect(afterTasks).toHaveLength(0);
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        schoolId: "school-1",
        action: "LEARNER_DELETE",
        resource: "Learner",
        resourceId: "learner-1",
        metadata: { schoolId: "school-1", learnerId: "learner-1" },
      },
    });
  });

  it("never throws when after() refuses and the inline insert also fails", async () => {
    afterRefusal = E468;
    auditLogCreate.mockRejectedValue(new Error("connection refused"));

    await expect(writeAudit(ENTRY)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("[audit] write failed:", expect.any(Error));
  });
});

describe("writeAuditMany", () => {
  const entries = [
    {
      userId: "user-1",
      schoolId: "school-1",
      action: AUDIT_ACTIONS.GRADE_LEVEL_CREATE,
      resource: "GradeLevel",
      resourceId: "grade-1",
      metadata: { schoolId: "school-1", gradeLevelId: "grade-1" },
    },
    {
      userId: "user-1",
      schoolId: "school-1",
      action: AUDIT_ACTIONS.SECTION_CREATE,
      resource: "Section",
      resourceId: "section-1",
      metadata: { schoolId: "school-1", sectionId: "section-1" },
    },
  ];

  it("queues one deferred task and issues one createMany for N entries", async () => {
    const pending = writeAuditMany(entries);
    expect(afterTasks).toHaveLength(1);
    await pending;

    await flushAfterTasks();

    expect(auditLogCreate).not.toHaveBeenCalled();
    expect(auditLogCreateMany).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user-1",
          schoolId: "school-1",
          action: "GRADE_LEVEL_CREATE",
          resource: "GradeLevel",
          resourceId: "grade-1",
          metadata: { schoolId: "school-1", gradeLevelId: "grade-1" },
        },
        {
          userId: "user-1",
          schoolId: "school-1",
          action: "SECTION_CREATE",
          resource: "Section",
          resourceId: "section-1",
          metadata: { schoolId: "school-1", sectionId: "section-1" },
        },
      ],
    });
  });

  it("falls back to one inline createMany when after() refuses", async () => {
    afterRefusal = E91;

    await expect(writeAuditMany(entries)).resolves.toBeUndefined();

    expect(afterTasks).toHaveLength(0);
    expect(auditLogCreateMany).toHaveBeenCalledTimes(1);
  });

  it("swallows and logs a createMany failure", async () => {
    auditLogCreateMany.mockRejectedValue(new Error("P2024 pool timeout"));

    await expect(writeAuditMany(entries)).resolves.toBeUndefined();
    await expect(flushAfterTasks()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("[audit] write failed:", expect.any(Error));
  });

  it("does nothing for an empty list", async () => {
    await writeAuditMany([]);

    expect(afterTasks).toHaveLength(0);
    expect(auditLogCreateMany).not.toHaveBeenCalled();
  });
});
