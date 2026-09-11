import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reporting is the one code path that runs when everything else has already
 * failed, so its obligations are unusual: it must never throw, it must produce
 * a record even when the database is the thing that broke, and it must never
 * carry a person's data into a table two UIs read back.
 */

const errorEventCreate = vi.fn();
const errorEventDeleteMany = vi.fn();
const userFindUnique = vi.fn();
const sendErrorAlert = vi.fn();
const deferred: Promise<unknown>[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    errorEvent: {
      get create() {
        return errorEventCreate;
      },
      get deleteMany() {
        return errorEventDeleteMany;
      },
    },
    user: {
      get findUnique() {
        return userFindUnique;
      },
    },
  },
}));
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => {
    deferred.push(task());
  },
}));
vi.mock("@/lib/errors/alert", () => ({
  get sendErrorAlert() {
    return sendErrorAlert;
  },
}));

import { AppError } from "@/lib/errors/app-error";
import { noteScopeUser, runInErrorScope } from "@/lib/errors/context";
import { newReference, reportError } from "@/lib/errors/report";
import { errorRetentionDays, purgeExpiredErrorEvents } from "@/lib/errors/retention";

async function flush() {
  await Promise.all(deferred.splice(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  errorEventCreate.mockResolvedValue({});
  sendErrorAlert.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("newReference", () => {
  it("is short, unambiguous and random", () => {
    const a = newReference();
    expect(a).toMatch(/^E-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(newReference()).not.toBe(a);
  });
});

describe("reportError", () => {
  it("returns a reference immediately and stores the event after the response", async () => {
    const cause = Object.assign(new Error("Timed out fetching a new connection"), { code: "P2024" });
    const ref = reportError(
      new AppError("DB_UNAVAILABLE", {
        cause,
        detail: "P2024 pool timeout",
        context: { prismaCode: "P2024" },
      }),
      { route: "saveSection", routeType: "action" }
    );
    expect(ref).toMatch(/^E-/);
    await flush();
    const row = errorEventCreate.mock.calls[0][0].data;
    expect(row).toMatchObject({
      ref,
      code: "DB_UNAVAILABLE",
      severity: "system",
      route: "saveSection",
      routeType: "action",
    });
    expect(row.message).toContain("P2024 pool timeout");
    expect(row.stack).toContain("Timed out");
    expect(row.context).toMatchObject({ prismaCode: "P2024" });
  });

  it("keeps only allow-listed context keys", async () => {
    reportError(
      new AppError("AUTH_FORBIDDEN", {
        context: { reason: "role_mismatch", email: "a@b.c", password: "x" },
      })
    );
    await flush();
    const ctx = errorEventCreate.mock.calls[0][0].data.context;
    expect(ctx.reason).toBe("role_mismatch");
    expect(ctx).not.toHaveProperty("email");
    expect(ctx).not.toHaveProperty("password");
  });

  it("uses the verified user from the action scope", async () => {
    await runInErrorScope("changePassword", async () => {
      noteScopeUser({ id: "user-1", schoolId: "school-1" });
      reportError(new AppError("AUTH_PROVIDER_ERROR"));
    });
    await flush();
    expect(errorEventCreate.mock.calls[0][0].data).toMatchObject({
      userId: "user-1",
      schoolId: "school-1",
      route: "changePassword",
    });
  });

  it("resolves a cookie-derived auth id to a user id, marked as such", async () => {
    userFindUnique.mockResolvedValue({ id: "user-9", schoolId: "school-9" });
    reportError(new AppError("INTERNAL_ERROR"), { authId: "auth-9", userSource: "cookie" });
    await flush();
    expect(errorEventCreate.mock.calls[0][0].data).toMatchObject({
      userId: "user-9",
      schoolId: "school-9",
    });
    expect(errorEventCreate.mock.calls[0][0].data.context.userSource).toBe("cookie");
  });

  it("writes one searchable JSON line to the log", () => {
    const ref = reportError(new AppError("INTERNAL_ERROR"));
    const line = vi
      .mocked(console.error)
      .mock.calls.map((c) => String(c[0]))
      .find((s) => s.includes(ref));
    expect(line).toBeDefined();
    expect(JSON.parse(line as string)).toMatchObject({
      tag: "litrack.error",
      ref,
      code: "INTERNAL_ERROR",
    });
  });

  it("never throws when the database is down — it logs and carries on", async () => {
    errorEventCreate.mockRejectedValue(new Error("P1001 can't reach database"));
    const ref = reportError(new AppError("DB_UNAVAILABLE"));
    expect(ref).toMatch(/^E-/);
    // The deferred write must settle, not reject: it runs after the response,
    // where a rejection would surface as an unhandled promise rejection.
    await expect(flush()).resolves.not.toThrow();
    expect(
      vi
        .mocked(console.error)
        .mock.calls.some((c) => String(c[0]).includes("ErrorEvent insert failed"))
    ).toBe(true);
  });

  it("alerts for system failures only", async () => {
    reportError(new AppError("DB_UNAVAILABLE"));
    reportError(new AppError("AUTH_FORBIDDEN"));
    await flush();
    expect(sendErrorAlert).toHaveBeenCalledTimes(1);
    expect(sendErrorAlert.mock.calls[0][0]).toMatchObject({ code: "DB_UNAVAILABLE" });
  });

  it("still alerts when the insert fails — the outage is the thing worth an email", async () => {
    errorEventCreate.mockRejectedValue(new Error("down"));
    reportError(new AppError("DB_UNAVAILABLE"));
    await flush();
    expect(sendErrorAlert).toHaveBeenCalledTimes(1);
  });

  it("files school-scoped refusals under the school", async () => {
    reportError(new AppError("AUTH_NO_SCHOOL_HEAD_ACCOUNT", { context: { schoolId: "school-3" } }));
    await flush();
    expect(errorEventCreate.mock.calls[0][0].data.schoolId).toBe("school-3");
  });
});

describe("retention", () => {
  it("defaults to 30 days and honours a sane override", () => {
    delete process.env.ERROR_EVENT_RETENTION_DAYS;
    expect(errorRetentionDays()).toBe(30);
    process.env.ERROR_EVENT_RETENTION_DAYS = "7";
    expect(errorRetentionDays()).toBe(7);
    process.env.ERROR_EVENT_RETENTION_DAYS = "0";
    expect(errorRetentionDays()).toBe(30);
    delete process.env.ERROR_EVENT_RETENTION_DAYS;
  });

  it("deletes only rows older than the cutoff", async () => {
    errorEventDeleteMany.mockResolvedValue({ count: 4 });
    const now = new Date("2026-09-30T00:00:00Z");
    await expect(purgeExpiredErrorEvents(now)).resolves.toBe(4);
    expect(errorEventDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-08-31T00:00:00Z") } },
    });
  });
});
