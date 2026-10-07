import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `revokeAllSessions` / `revokeOtherSessions` (src/lib/auth/auth-session.ts)
 * run for real against a fake `prismaFresh`. Every action test mocks these two
 * away, so this is the only place the where-clause is checked: a wrong filter
 * here would either leave a stolen session alive or sign the caller out of
 * the device they are using (or, worst, delete another user's sessions).
 */

const deleteMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prismaFresh: { authSession: { deleteMany } },
  prisma: { authSession: { deleteMany } },
}));
vi.mock("@/lib/auth/better-auth", () => ({ getAuth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

import { revokeAllSessions, revokeOtherSessions } from "@/lib/auth/auth-session";

beforeEach(() => {
  deleteMany.mockReset().mockResolvedValue({ count: 3 });
});

describe("revokeAllSessions", () => {
  it("deletes every session of exactly that user, and returns the count", async () => {
    await expect(revokeAllSessions("auth-1")).resolves.toBe(3);

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "auth-1" } });
  });

  it("lets a database failure reach the caller instead of reporting success", async () => {
    deleteMany.mockRejectedValue(new Error("db down"));
    await expect(revokeAllSessions("auth-1")).rejects.toThrow("db down");
  });
});

describe("revokeOtherSessions", () => {
  it("deletes the user's sessions except the one holding keepToken", async () => {
    await expect(revokeOtherSessions("auth-1", "tok-keep")).resolves.toBe(3);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "auth-1", token: { not: "tok-keep" } },
    });
  });

  it("keeps nothing when the current token is unknown", async () => {
    await revokeOtherSessions("auth-1", null);

    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "auth-1" } });
  });

  it("never widens past the one user, whichever token is passed", async () => {
    await revokeOtherSessions("auth-1", "tok");
    await revokeOtherSessions("auth-1", null);

    for (const [arg] of deleteMany.mock.calls) {
      expect((arg as { where: { userId: string } }).where.userId).toBe("auth-1");
    }
  });
});
