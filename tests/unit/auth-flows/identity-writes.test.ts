import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * The write paths of `src/lib/auth/identity.ts`, run for real against a fake
 * Prisma transaction client (every other test mocks this module away). Pins
 * what actually reaches the `AuthUser` / `AuthAccount` tables:
 *  - setPassword touches only the CREDENTIAL account of that one user;
 *  - a missing identity is IDENTITY_NOT_FOUND, never a silent no-op;
 *  - createIdentity stores the caller's bcrypt hash verbatim (never re-hashed);
 *  - email is stored lowercased, a duplicate is AUTH_EMAIL_IN_USE;
 *  - deleteIdentity is idempotent.
 */

const prismaFresh = vi.hoisted(() => ({
  $transaction: vi.fn(),
  authUser: {},
  authAccount: {},
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaFresh, prismaFresh }));

import {
  createIdentity,
  deleteIdentity,
  setEmail,
  setPassword,
  setRole,
} from "@/lib/auth/identity";
import { isBcryptHash } from "@/lib/auth/password-hash";

const HASH = "$2b$10$6cWRMEACPMUmzaFFxbQCDOZiXb/TAO7wl1UD6E1hbhMOXhP.9/S26";
const AUTH_ID = "11111111-1111-4111-8111-111111111111";

function fakeTx() {
  return {
    authUser: {
      create: vi.fn(async (..._a: unknown[]) => ({})),
      updateMany: vi.fn(async (..._a: unknown[]) => ({ count: 1 })),
      deleteMany: vi.fn(async (..._a: unknown[]) => ({ count: 1 })),
      findUnique: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ id: AUTH_ID })),
    },
    authAccount: {
      create: vi.fn(async (..._a: unknown[]) => ({})),
      updateMany: vi.fn(async (..._a: unknown[]) => ({ count: 1 })),
    },
  };
}
type Tx = ReturnType<typeof fakeTx>;
// The module wants a Prisma.TransactionClient; the fake implements what it calls.
const asDb = (tx: Tx) => tx as unknown as Prisma.TransactionClient;

function p2002(target: unknown) {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

let tx: Tx;
beforeEach(() => {
  tx = fakeTx();
  prismaFresh.$transaction.mockReset();
});

describe("setPassword", () => {
  it("updates only the credential account of that user, with the hash verbatim", async () => {
    await setPassword(AUTH_ID, { hash: HASH }, asDb(tx));

    expect(tx.authAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.authAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: AUTH_ID, providerId: "credential" },
      data: { password: HASH },
    });
    expect(tx.authAccount.create).not.toHaveBeenCalled();
    expect(tx.authUser.findUnique).not.toHaveBeenCalled();
  });

  it("hashes a plaintext password to bcrypt before writing it", async () => {
    await setPassword(AUTH_ID, "Plain-Text-1", asDb(tx));

    const data = (tx.authAccount.updateMany.mock.calls[0][0] as { data: { password: string } }).data;
    expect(data.password).not.toBe("Plain-Text-1");
    expect(isBcryptHash(data.password)).toBe(true);
  });

  it("throws IDENTITY_NOT_FOUND when there is no credential account and no AuthUser", async () => {
    tx.authAccount.updateMany.mockResolvedValue({ count: 0 });
    tx.authUser.findUnique.mockResolvedValue(null);

    await expect(setPassword(AUTH_ID, { hash: HASH }, asDb(tx))).rejects.toMatchObject({
      name: "AppError",
      code: "IDENTITY_NOT_FOUND",
    });
    expect(tx.authAccount.create).not.toHaveBeenCalled();
  });

  it("creates the credential account when the user exists but has none", async () => {
    tx.authAccount.updateMany.mockResolvedValue({ count: 0 });

    await setPassword(AUTH_ID, { hash: HASH }, asDb(tx));

    expect(tx.authAccount.create).toHaveBeenCalledTimes(1);
    expect(tx.authAccount.create).toHaveBeenCalledWith({
      data: {
        id: AUTH_ID,
        accountId: AUTH_ID,
        providerId: "credential",
        userId: AUTH_ID,
        password: HASH,
      },
    });
  });
});

describe("createIdentity", () => {
  it("writes the AuthUser and the credential AuthAccount with the given hash verbatim", async () => {
    const result = await createIdentity(
      { email: "  Head@School.Example ", password: { hash: HASH }, role: "SCHOOL_HEAD", authId: AUTH_ID },
      asDb(tx)
    );

    expect(result).toEqual({ authId: AUTH_ID });
    expect(prismaFresh.$transaction).not.toHaveBeenCalled(); // the caller's tx is used
    expect(tx.authUser.create).toHaveBeenCalledTimes(1);
    expect(tx.authUser.create.mock.calls[0][0]).toMatchObject({
      data: { id: AUTH_ID, email: "head@school.example", role: "SCHOOL_HEAD", banned: false },
    });
    expect(tx.authAccount.create).toHaveBeenCalledTimes(1);
    expect(tx.authAccount.create.mock.calls[0][0]).toMatchObject({
      data: { id: AUTH_ID, accountId: AUTH_ID, userId: AUTH_ID, providerId: "credential", password: HASH },
    });
    // User row first, so the account's foreign key has something to point at.
    expect(tx.authUser.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.authAccount.create.mock.invocationCallOrder[0]
    );
  });

  it("generates an authId when none is given and returns the one it wrote", async () => {
    const { authId } = await createIdentity(
      { email: "t@x.example", password: { hash: HASH }, role: "TEACHER" },
      asDb(tx)
    );

    expect(authId).toMatch(/^[0-9a-f-]{36}$/);
    expect((tx.authUser.create.mock.calls[0][0] as { data: { id: string } }).data.id).toBe(authId);
  });

  it("opens its own transaction (both rows together) when no tx is passed", async () => {
    const own = fakeTx();
    prismaFresh.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(own));

    await createIdentity({ email: "t@x.example", password: { hash: HASH }, role: "TEACHER" });

    expect(prismaFresh.$transaction).toHaveBeenCalledTimes(1);
    expect(own.authUser.create).toHaveBeenCalledTimes(1);
    expect(own.authAccount.create).toHaveBeenCalledTimes(1);
  });

  it("maps a duplicate email to AUTH_EMAIL_IN_USE", async () => {
    tx.authUser.create.mockRejectedValue(p2002(["email"]));

    await expect(
      createIdentity({ email: "t@x.example", password: { hash: HASH }, role: "TEACHER" }, asDb(tx))
    ).rejects.toMatchObject({ code: "AUTH_EMAIL_IN_USE" });
    expect(tx.authAccount.create).not.toHaveBeenCalled();
  });

  it("does not turn an unrelated P2002 or another failure into AUTH_EMAIL_IN_USE", async () => {
    tx.authUser.create.mockRejectedValue(p2002(["id"]));
    await expect(
      createIdentity({ email: "t@x.example", password: { hash: HASH }, role: "TEACHER" }, asDb(tx))
    ).rejects.toMatchObject({ code: "P2002" });

    const boom = new Error("connection reset");
    tx.authUser.create.mockRejectedValue(boom);
    await expect(
      createIdentity({ email: "t@x.example", password: { hash: HASH }, role: "TEACHER" }, asDb(tx))
    ).rejects.toBe(boom);
  });
});

describe("setEmail / setRole / deleteIdentity", () => {
  it("setEmail updates exactly that user, with the email lowercased", async () => {
    await setEmail(AUTH_ID, "  New@Mail.Example ", asDb(tx));

    expect(tx.authUser.updateMany).toHaveBeenCalledWith({
      where: { id: AUTH_ID },
      data: { email: "new@mail.example" },
    });
  });

  it("setEmail throws IDENTITY_NOT_FOUND when no row matched, AUTH_EMAIL_IN_USE on a conflict", async () => {
    tx.authUser.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(setEmail(AUTH_ID, "a@b.example", asDb(tx))).rejects.toMatchObject({
      code: "IDENTITY_NOT_FOUND",
    });

    tx.authUser.updateMany.mockRejectedValueOnce(p2002(["email"]));
    await expect(setEmail(AUTH_ID, "a@b.example", asDb(tx))).rejects.toMatchObject({
      code: "AUTH_EMAIL_IN_USE",
    });
  });

  it("setRole updates exactly that user and throws IDENTITY_NOT_FOUND when none matched", async () => {
    await setRole(AUTH_ID, "DISTRICT_ADMIN", asDb(tx));
    expect(tx.authUser.updateMany).toHaveBeenCalledWith({
      where: { id: AUTH_ID },
      data: { role: "DISTRICT_ADMIN" },
    });

    tx.authUser.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(setRole(AUTH_ID, "TEACHER", asDb(tx))).rejects.toMatchObject({
      code: "IDENTITY_NOT_FOUND",
    });
  });

  it("deleteIdentity deletes only that user and reports whether a row went; a missing one is success", async () => {
    await expect(deleteIdentity(AUTH_ID, asDb(tx))).resolves.toEqual({ deleted: true });
    expect(tx.authUser.deleteMany).toHaveBeenCalledWith({ where: { id: AUTH_ID } });

    tx.authUser.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(deleteIdentity(AUTH_ID, asDb(tx))).resolves.toEqual({ deleted: false });
  });
});
