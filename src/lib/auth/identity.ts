import "server-only";
import { Prisma } from "@prisma/client";
import { prismaFresh } from "@/lib/prisma";
import { AppError } from "@/lib/errors/app-error";
import { parseAppMetadataRole, type AppRole } from "@/lib/auth/roles";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import {
  CREDENTIAL_PROVIDER_ID,
  buildIdentityRows,
  normalizeIdentityEmail,
} from "@/lib/auth/identity-rows";

/**
 * Sign-in identities (`AuthUser` + credential `AuthAccount`), written directly
 * through Prisma — the replacement for `supabase.auth.admin.*`.
 *
 * Why not Better Auth's admin endpoints (`createUser`, `setUserPassword`):
 * they need an admin session in the request headers (self-registration,
 * School Head approval and scripts have none) and enforce a minimum password
 * length the 6-digit School ID password fails. See spec section 8.
 *
 * Every writer takes an optional transaction client so the identity change
 * commits atomically with the `User` write it mirrors (invariants I1–I3).
 * Without one it uses `prismaFresh`, never the cached client (invariant I5).
 *
 * Passwords: pass a plaintext string and it is hashed here, or `{ hash }` when
 * the caller hashed it beforehand — do that to keep a ~100 ms bcrypt out of a
 * transaction that holds row locks.
 */

/** Interactive transaction client, or the root client. */
export type IdentityDb = Prisma.TransactionClient;

export type PasswordInput = string | { hash: string };

async function toHash(password: PasswordInput): Promise<string> {
  return typeof password === "string" ? hashPassword(password) : password.hash;
}

function identityNotFound(authId: string, operation: string): AppError {
  return new AppError("IDENTITY_NOT_FOUND", {
    detail: `No AuthUser ${authId} for ${operation}`,
    context: { reason: "identity_not_found", operation },
  });
}

/** P2002 on `AuthUser.email` — another identity already signs in with it. */
function isEmailConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  // An unknown target is still most plausibly the email: `id` is a fresh uuid.
  return fields.length === 0 || fields.some((f) => String(f).includes("email"));
}

function emailInUse(err: unknown): AppError {
  return new AppError("AUTH_EMAIL_IN_USE", {
    cause: err,
    context: { reason: "identity_email_conflict" },
  });
}

export type CreateIdentityInput = {
  email: string;
  password: PasswordInput;
  role: AppRole;
  /** Defaults to a new uuid. Pass one only to recreate a known identity. */
  authId?: string;
  emailVerified?: boolean;
};

/**
 * Create the identity and return its id — the value to store in `User.authId`.
 * Throws `AUTH_EMAIL_IN_USE` when another identity already has the email.
 * Call inside the same transaction as the `User.create`.
 */
export async function createIdentity(
  input: CreateIdentityInput,
  tx?: IdentityDb
): Promise<{ authId: string }> {
  const authId = input.authId ?? crypto.randomUUID();
  const rows = buildIdentityRows({
    authId,
    email: input.email,
    role: input.role,
    passwordHash: await toHash(input.password),
    emailVerified: input.emailVerified,
  });
  const write = async (db: IdentityDb) => {
    await db.authUser.create({ data: rows.user });
    await db.authAccount.create({ data: rows.account });
  };
  try {
    // Two rows, so without a caller's transaction it opens its own: an
    // AuthUser without its credential could never sign in.
    if (tx) await write(tx);
    else await prismaFresh.$transaction(write);
  } catch (err) {
    if (isEmailConflict(err)) throw emailInUse(err);
    throw err;
  }
  return { authId };
}

/**
 * Replace the password. Creates the credential account if the identity has
 * none. Throws `IDENTITY_NOT_FOUND` when no `AuthUser` exists (e.g. a restored
 * teacher whose identity was deleted); callers map that to their own code.
 * Does not end existing sessions.
 */
export async function setPassword(
  authId: string,
  password: PasswordInput,
  tx: IdentityDb = prismaFresh
): Promise<void> {
  const hash = await toHash(password);
  const updated = await tx.authAccount.updateMany({
    where: { userId: authId, providerId: CREDENTIAL_PROVIDER_ID },
    data: { password: hash },
  });
  if (updated.count > 0) return;

  const user = await tx.authUser.findUnique({ where: { id: authId }, select: { id: true } });
  if (!user) throw identityNotFound(authId, "setPassword");
  await tx.authAccount.create({
    data: {
      id: authId,
      accountId: authId,
      providerId: CREDENTIAL_PROVIDER_ID,
      userId: authId,
      password: hash,
    },
  });
}

/**
 * Change the sign-in email (stored lowercased). Throws `AUTH_EMAIL_IN_USE` on
 * a conflict and `IDENTITY_NOT_FOUND` when there is no identity. Call in the
 * same transaction as the `User.email` update (invariant I2).
 */
export async function setEmail(
  authId: string,
  email: string,
  tx: IdentityDb = prismaFresh
): Promise<void> {
  let count: number;
  try {
    ({ count } = await tx.authUser.updateMany({
      where: { id: authId },
      data: { email: normalizeIdentityEmail(email) },
    }));
  } catch (err) {
    if (isEmailConflict(err)) throw emailInUse(err);
    throw err;
  }
  if (count === 0) throw identityNotFound(authId, "setEmail");
}

/**
 * Mirror `User.role` onto the identity (invariant I3). Middleware reads it
 * from the cookie cache, so a stale value is visible for up to 15 minutes.
 * Throws `IDENTITY_NOT_FOUND` when there is no identity.
 */
export async function setRole(
  authId: string,
  role: AppRole,
  tx: IdentityDb = prismaFresh
): Promise<void> {
  const { count } = await tx.authUser.updateMany({ where: { id: authId }, data: { role } });
  if (count === 0) throw identityNotFound(authId, "setRole");
}

/**
 * Delete the identity; sessions and accounts cascade. Idempotent: a missing
 * identity is success. Returns whether a row was actually deleted.
 */
export async function deleteIdentity(
  authId: string,
  tx: IdentityDb = prismaFresh
): Promise<{ deleted: boolean }> {
  const { count } = await tx.authUser.deleteMany({ where: { id: authId } });
  return { deleted: count > 0 };
}

/**
 * Whether `password` is this identity's current password (the "current
 * password" check before a change). False when there is no identity or no
 * credential — a signed-in user always has both, so that case is not worth a
 * distinct error.
 */
export async function verifyAccountPassword(authId: string, password: string): Promise<boolean> {
  const account = await prismaFresh.authAccount.findFirst({
    where: { userId: authId, providerId: CREDENTIAL_PROVIDER_ID },
    select: { password: true },
  });
  if (!account?.password) return false;
  return verifyPassword({ hash: account.password, password });
}

export type IdentitySummary = {
  authId: string;
  email: string;
  role: AppRole | null;
  hasPassword: boolean;
};

/** The identity that signs in with `email` (case-insensitive), or null. */
export async function findIdentityByEmail(
  email: string,
  tx: IdentityDb = prismaFresh
): Promise<IdentitySummary | null> {
  const user = await tx.authUser.findUnique({
    where: { email: normalizeIdentityEmail(email) },
    select: {
      id: true,
      email: true,
      role: true,
      accounts: {
        where: { providerId: CREDENTIAL_PROVIDER_ID },
        select: { password: true },
        take: 1,
      },
    },
  });
  if (!user) return null;
  return {
    authId: user.id,
    email: user.email,
    role: parseAppMetadataRole(user.role),
    hasPassword: Boolean(user.accounts[0]?.password),
  };
}
