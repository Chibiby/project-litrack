/**
 * The exact `AuthUser` + credential `AuthAccount` rows one LITRACK identity
 * is made of. Pure (relative imports only, no `server-only`): the identity
 * module, the backfill (`scripts/backfill-better-auth-users.ts`) and the ops
 * scripts all build rows here, so the shape cannot drift between them.
 *
 * Shape rules (spec sections 2 and 4):
 * - `AuthUser.id` is the existing `User.authId`; nothing in `User` is rewritten.
 * - `name` is always "" (`User.fullName` is authoritative).
 * - The credential account has `providerId: "credential"` and
 *   `accountId === userId === authId`. Better Auth's `signInEmail` looks the
 *   account up by exactly that pair, so any other `accountId` cannot sign in.
 * - The account's `id` is the authId too: one credential per user, so it is
 *   unique, and a re-run of the backfill upserts the same row.
 */

import type { AppRole } from "./roles";

export const CREDENTIAL_PROVIDER_ID = "credential";

/** Better Auth looks users up by `email.toLowerCase()`; store it that way. */
export function normalizeIdentityEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type AuthUserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AppRole;
  banned: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthAccountRow = {
  id: string;
  accountId: string;
  providerId: typeof CREDENTIAL_PROVIDER_ID;
  userId: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
};

export type IdentityRowInput = {
  authId: string;
  email: string;
  role: AppRole;
  /** Already hashed (`@/lib/auth/password-hash`). Never a plaintext password. */
  passwordHash: string;
  emailVerified?: boolean;
  createdAt?: Date;
  /** Defaults to `createdAt`. The backfill passes Supabase's `updated_at` (newer wins). */
  updatedAt?: Date;
};

export function buildIdentityRows(input: IdentityRowInput): {
  user: AuthUserRow;
  account: AuthAccountRow;
} {
  const createdAt = input.createdAt ?? new Date();
  const updatedAt = input.updatedAt ?? createdAt;
  return {
    user: {
      id: input.authId,
      name: "",
      email: normalizeIdentityEmail(input.email),
      emailVerified: input.emailVerified ?? true,
      role: input.role,
      banned: false,
      createdAt,
      updatedAt,
    },
    account: {
      id: input.authId,
      accountId: input.authId,
      providerId: CREDENTIAL_PROVIDER_ID,
      userId: input.authId,
      password: input.passwordHash,
      createdAt,
      updatedAt,
    },
  };
}
