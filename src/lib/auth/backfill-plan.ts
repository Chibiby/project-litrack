/**
 * Pure planner for the Supabase Auth -> Better Auth backfill
 * (`scripts/backfill-better-auth-users.ts`, spec section 4).
 *
 * No I/O, no `server-only`, relative imports only: the script feeds it rows it
 * has already read, and unit tests feed it fixtures. Rows are built with
 * `buildIdentityRows`, the same builder the app's identity module uses, so a
 * backfilled identity is indistinguishable from one the app created.
 *
 * Rules:
 * - Join Supabase `auth.users.id` to `User.authId`.
 * - `User.email` and `User.role` are authoritative (sign-in passes `User.email`;
 *   Supabase `app_metadata.role` is null on some accounts). A differing Supabase
 *   email is reported, not used.
 * - Auth users with no `User` row are orphans (abandoned registrations): skipped.
 * - Live Users with no auth user are reported (they cannot sign in after cutover).
 * - Soft-deleted Users that still have an auth user are backfilled too, so a
 *   later restore keeps a working login.
 * - Newer wins: an existing identity whose `updatedAt` is at or after the
 *   source's is left alone, matching the SQL `WHERE ... < EXCLUDED."updatedAt"`.
 *
 * The plan never carries a hash anywhere except inside `writes[].account.password`;
 * every count and list in it is safe to print.
 */

import type { AppRole } from "./roles";
import {
  buildIdentityRows,
  normalizeIdentityEmail,
  type AuthAccountRow,
  type AuthUserRow,
} from "./identity-rows";

/** One `auth.users` row from Supabase (already filtered to bcrypt hashes). */
export type SourceAuthUser = {
  id: string;
  email: string | null;
  passwordHash: string;
  emailConfirmed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** One `public."User"` row from Neon. */
export type TargetUser = {
  authId: string;
  email: string;
  role: AppRole;
  deletedAt: Date | null;
};

/** What already exists in Neon `"AuthUser"` (id + `updatedAt` only). */
export type ExistingAuthUser = {
  id: string;
  updatedAt: Date;
};

export type BackfillWrite = {
  kind: "create" | "update";
  user: AuthUserRow;
  account: AuthAccountRow;
};

export type AuthBackfillPlan = {
  /** Rows to upsert: new identities plus ones whose source is newer. */
  writes: BackfillWrite[];
  counts: {
    source: number;
    targetUsers: number;
    create: number;
    update: number;
    /** Already present and at least as new as the source. */
    unchanged: number;
    /** Auth users with no `User` row: skipped. */
    orphans: number;
    /** Live (`deletedAt` null) Users with no auth user. */
    liveWithoutAuth: number;
    /** Soft-deleted Users with no auth user (expected; informational). */
    deletedWithoutAuth: number;
    /** Soft-deleted Users that do have an auth user (backfilled). */
    deletedWithAuth: number;
    /** Supabase email differs from `User.email` (User wins). */
    emailMismatches: number;
    /** Source rows whose bcrypt prefix is not `$2a$/$2b$/$2y$`: skipped. */
    nonBcrypt: number;
  };
  /** authIds only — safe to print. */
  orphanIds: string[];
  liveWithoutAuthIds: string[];
  emailMismatchIds: string[];
  nonBcryptIds: string[];
  /**
   * Emails that two planned AuthUsers would share. `AuthUser.email` is unique,
   * so the script must refuse to apply while this is non-empty.
   */
  duplicateEmails: string[];
};

const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

export function planAuthBackfill(
  source: readonly SourceAuthUser[],
  users: readonly TargetUser[],
  existing: readonly ExistingAuthUser[] = [],
): AuthBackfillPlan {
  const sourceById = new Map<string, SourceAuthUser>();
  for (const row of source) sourceById.set(row.id, row);

  const existingById = new Map<string, Date>();
  for (const row of existing) existingById.set(row.id, row.updatedAt);

  const userAuthIds = new Set<string>();
  const writes: BackfillWrite[] = [];
  const liveWithoutAuthIds: string[] = [];
  const emailMismatchIds: string[] = [];
  const nonBcryptIds: string[] = [];
  const emailOwners = new Map<string, string>();
  const duplicateEmails = new Set<string>();

  let deletedWithoutAuth = 0;
  let deletedWithAuth = 0;
  let unchanged = 0;

  for (const user of users) {
    userAuthIds.add(user.authId);
    const src = sourceById.get(user.authId);

    if (!src) {
      if (user.deletedAt === null) liveWithoutAuthIds.push(user.authId);
      else deletedWithoutAuth += 1;
      continue;
    }
    if (user.deletedAt !== null) deletedWithAuth += 1;

    if (!BCRYPT_PREFIX.test(src.passwordHash)) {
      nonBcryptIds.push(user.authId);
      continue;
    }

    const email = normalizeIdentityEmail(user.email);
    if (src.email !== null && normalizeIdentityEmail(src.email) !== email) {
      emailMismatchIds.push(user.authId);
    }

    const owner = emailOwners.get(email);
    if (owner !== undefined && owner !== user.authId) duplicateEmails.add(email);
    else emailOwners.set(email, user.authId);

    const existingUpdatedAt = existingById.get(user.authId);
    if (existingUpdatedAt !== undefined && existingUpdatedAt.getTime() >= src.updatedAt.getTime()) {
      unchanged += 1;
      continue;
    }

    const rows = buildIdentityRows({
      authId: user.authId,
      email,
      role: user.role,
      passwordHash: src.passwordHash,
      emailVerified: src.emailConfirmed,
      createdAt: src.createdAt,
      updatedAt: src.updatedAt,
    });
    writes.push({ kind: existingUpdatedAt === undefined ? "create" : "update", ...rows });
  }

  const orphanIds = source.filter((row) => !userAuthIds.has(row.id)).map((row) => row.id);

  return {
    writes,
    counts: {
      source: source.length,
      targetUsers: users.length,
      create: writes.filter((w) => w.kind === "create").length,
      update: writes.filter((w) => w.kind === "update").length,
      unchanged,
      orphans: orphanIds.length,
      liveWithoutAuth: liveWithoutAuthIds.length,
      deletedWithoutAuth,
      deletedWithAuth,
      emailMismatches: emailMismatchIds.length,
      nonBcrypt: nonBcryptIds.length,
    },
    orphanIds,
    liveWithoutAuthIds,
    emailMismatchIds,
    nonBcryptIds,
    duplicateEmails: [...duplicateEmails],
  };
}

/** Split into fixed-size batches (the script writes 500 per statement). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
