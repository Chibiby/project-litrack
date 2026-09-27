import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `recordLastLogin` replaced the `LOGIN_SUCCESS` audit row as the source of
 * "last signed in". Pinned: it writes `User.lastLoginAt` for exactly the
 * signed-in user, stamps the time of sign-in (not of the deferred write), and
 * never throws — a failed stamp must not fail a login.
 */

const userUpdate = vi.fn(async (_args: unknown) => ({ id: "user-1" }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { update: (...args: unknown[]) => userUpdate(...(args as [never])) } },
}));

type AfterTask = () => Promise<void> | void;
let afterTasks: AfterTask[] = [];
let afterRefuses = false;
vi.mock("next/server", () => ({
  after: (task: AfterTask) => {
    if (afterRefuses) throw new Error("`after` was called outside a request scope");
    afterTasks.push(task);
  },
}));

const { recordLastLogin } = await import("@/lib/auth/last-login");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  afterTasks = [];
  afterRefuses = false;
  userUpdate.mockResolvedValue({ id: "user-1" });
});

describe("recordLastLogin", () => {
  it("defers the write, then sets lastLoginAt on that user only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T01:00:00.000Z"));

    await recordLastLogin("user-1");
    expect(userUpdate).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);

    // The deferred task runs later; the stamp must still be the sign-in time.
    vi.setSystemTime(new Date("2026-09-27T01:00:05.000Z"));
    await afterTasks[0]();

    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastLoginAt: new Date("2026-09-27T01:00:00.000Z") },
      select: { id: true },
    });
  });

  it("writes inline when after() refuses", async () => {
    afterRefuses = true;
    await recordLastLogin("user-2");

    expect(afterTasks).toHaveLength(0);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-2" }, data: { lastLoginAt: expect.any(Date) } })
    );
  });

  it("never throws when the update fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    afterRefuses = true;
    userUpdate.mockRejectedValue(new Error("P2024 pool timeout"));

    await expect(recordLastLogin("user-3")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("[login] lastLoginAt update failed:", expect.any(Error));
    consoleError.mockRestore();
  });
});
