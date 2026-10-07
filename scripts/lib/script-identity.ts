/**
 * Better Auth identity writes for the `scripts/*.ts` ops commands. Replaces the
 * Supabase admin API those scripts used to call.
 *
 * Takes the script's own PrismaClient (`connectScriptPrisma`) and imports only
 * the pure helpers (`identity-rows`, `password-hash`): no `server-only`, no
 * `@/` alias, no app singletons. Rows are built by `buildIdentityRows`, so a
 * script-made identity has exactly the shape the app and the backfill make.
 *
 * Never logs or returns a plaintext password.
 */
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { buildIdentityRows, normalizeIdentityEmail } from "../../src/lib/auth/identity-rows";
import { hashPassword } from "../../src/lib/auth/password-hash";
import type { AppRole } from "../../src/lib/auth/roles";

/** A fresh `User.authId` / `AuthUser.id` for an identity that does not exist yet. */
export function newAuthId(): string {
  return crypto.randomUUID();
}

/** email (lower-cased) -> AuthUser.id for every identity. One query, for resumable runs. */
export async function loadAuthEmailIndex(prisma: PrismaClient): Promise<Map<string, string>> {
  const rows = await prisma.authUser.findMany({ select: { id: true, email: true } });
  return new Map(rows.map((r) => [r.email.toLowerCase(), r.id]));
}

/** AuthUser.id for an email, or null. */
export async function findAuthIdByEmail(prisma: PrismaClient, email: string): Promise<string | null> {
  const row = await prisma.authUser.findUnique({
    where: { email: normalizeIdentityEmail(email) },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Create or update the AuthUser + credential AuthAccount for `authId`.
 * Idempotent: a re-run with the same authId rewrites the password and role.
 * A different AuthUser already holding `email` makes the unique index throw,
 * which is the right outcome (never steal another identity's address).
 */
export async function upsertCredentialIdentity(
  prisma: PrismaClient,
  input: { authId: string; email: string; role: AppRole; password: string },
): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  const { user, account } = buildIdentityRows({
    authId: input.authId,
    email: input.email,
    role: input.role,
    passwordHash,
  });
  await prisma.$transaction([
    prisma.authUser.upsert({
      where: { id: user.id },
      create: user,
      update: { email: user.email, role: user.role, banned: false, updatedAt: new Date() },
    }),
    prisma.authAccount.upsert({
      where: { id: account.id },
      create: account,
      update: { password: account.password, updatedAt: new Date() },
    }),
  ]);
}

/** Set a new password (and optionally a new email) on an existing identity. */
export async function updateIdentity(
  prisma: PrismaClient,
  authId: string,
  changes: { password?: string; email?: string; role?: AppRole },
): Promise<void> {
  const existing = await prisma.authUser.findUnique({
    where: { id: authId },
    select: { id: true, email: true, role: true },
  });
  if (!existing) throw new Error(`no Better Auth identity for authId ${authId}`);

  const email = changes.email ? normalizeIdentityEmail(changes.email) : existing.email;
  const role = (changes.role ?? existing.role ?? "TEACHER") as AppRole;

  if (changes.password) {
    await upsertCredentialIdentity(prisma, { authId, email, role, password: changes.password });
    return;
  }
  await prisma.authUser.update({
    where: { id: authId },
    data: { email, role, updatedAt: new Date() },
  });
}

/**
 * Delete identities (sessions and accounts cascade). Already-absent is success.
 * Returns how many rows were removed.
 */
export async function deleteIdentities(prisma: PrismaClient, authIds: string[]): Promise<number> {
  if (authIds.length === 0) return 0;
  const res = await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  return res.count;
}
