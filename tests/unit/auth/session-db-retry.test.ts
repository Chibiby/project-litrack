import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getCurrentUser` retries its user lookup once when the database was briefly
 * unavailable. It used to key on P2024, which Prisma 6's client engine never
 * raises, so the retry never fired; a dropped pooler connection (P1017) went
 * straight to error.tsx.
 *
 * The real `session.ts` runs; only the request edges are faked.
 */

vi.mock("next/navigation", () => ({
  redirect: (p: string) => {
    throw new Error(`NEXT_REDIRECT:${p}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("@/lib/auth/auth-session", () => ({
  getAuthSession: async () => ({ user: { id: "auth-1" }, session: { impersonatedBy: null } }),
  endCurrentSession: vi.fn(async () => true),
  revokeAllSessions: vi.fn(async () => 0),
}));
vi.mock("@/lib/auth/impersonation-session", () => ({
  expireImpersonationCookies: vi.fn(async () => {}),
  isVerifiedImpersonationOf: vi.fn(async () => false),
}));

const userFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } },
}));
vi.mock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));

const { getCurrentUser } = await import("@/lib/auth/session");

const USER = {
  id: "user-1",
  authId: "auth-1",
  role: "SCHOOL_HEAD",
  schoolId: "school-1",
  deletedAt: null,
  isActive: true,
  approvalStatus: null,
  mustChangePassword: false,
};

function prismaKnown(code: string, message: string) {
  return Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code });
}

beforeEach(() => {
  userFindUnique.mockReset();
});

describe("getCurrentUser — one retry when the database was unavailable", () => {
  it("retries a dropped connection (P1017) once and returns the user", async () => {
    userFindUnique
      .mockRejectedValueOnce(prismaKnown("P1017", "Server has closed the connection."))
      .mockResolvedValueOnce(USER);

    await expect(getCurrentUser()).resolves.toMatchObject({ id: "user-1" });
    expect(userFindUnique).toHaveBeenCalledTimes(2);
  });

  it("retries only once: a second outage propagates", async () => {
    const second = prismaKnown("P1001", "Can't reach database server");
    userFindUnique
      .mockRejectedValueOnce(prismaKnown("P1017", "Server has closed the connection."))
      .mockRejectedValueOnce(second);

    await expect(getCurrentUser()).rejects.toBe(second);
    expect(userFindUnique).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failure retrying cannot fix", async () => {
    const stale = prismaKnown("P2022", 'column "lastLoginAt" does not exist');
    userFindUnique.mockRejectedValueOnce(stale);

    await expect(getCurrentUser()).rejects.toBe(stale);
    expect(userFindUnique).toHaveBeenCalledTimes(1);
  });
});
