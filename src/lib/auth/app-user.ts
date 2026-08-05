import "server-only";
import type { User, UserRole } from "@prisma/client";
import type { User as AuthUser, SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServiceEnv } from "@/lib/supabase/env";

/** Prisma model User → public."User" (no @@map). PostgREST exposes it as "User". */
const USER_TABLE = "User";

const USER_SELECT =
  "id, authId, email, role, schoolId, firstName, middleName, lastName, fullName, isActive, profileCompleted, createdAt, updatedAt, deletedAt";

type PostgrestUserRow = {
  id: string;
  authId: string;
  email: string;
  role: UserRole;
  schoolId: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  isActive: boolean;
  profileCompleted: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export function isPrismaConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    message.includes("DATABASE") ||
    message.includes("Prisma") ||
    message.includes("Environment variable not found") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("P1001") ||
    message.includes("P1000") ||
    message.includes("P1017") ||
    message.includes("Can't reach database") ||
    message.includes("can't reach database") ||
    message.includes("tenant/user") ||
    message.includes("Connection refused") ||
    message.includes("connection timed out")
  );
}

/** Active, non-deleted app users only. */
export function isUsableAppUser(user: User): boolean {
  return user.isActive === true && user.deletedAt == null;
}

function mapPostgrestUser(row: PostgrestUserRow): User {
  return {
    id: row.id,
    authId: row.authId,
    email: row.email,
    role: row.role,
    schoolId: row.schoolId,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    fullName: row.fullName,
    isActive: row.isActive,
    profileCompleted: row.profileCompleted,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
  };
}

/**
 * Privilege role from Auth JWT. Only `app_metadata.role` is trusted
 * (service-role-set). Never read `user_metadata` for authorization.
 */
function roleFromAuthClaims(authUser: AuthUser): UserRole | null {
  const appRole = authUser.app_metadata?.role;
  const role = typeof appRole === "string" ? appRole : null;
  if (role === "SUPER_ADMIN" || role === "SCHOOL_HEAD" || role === "TEACHER") {
    return role;
  }
  return null;
}

/** Minimal SUPER_ADMIN User when DB/PostgREST are unavailable but app_metadata claims role. */
function superAdminFromAuthClaims(authUser: AuthUser): User | null {
  if (roleFromAuthClaims(authUser) !== "SUPER_ADMIN") return null;
  const email = authUser.email ?? "";
  return {
    id: authUser.id,
    authId: authUser.id,
    email,
    role: "SUPER_ADMIN",
    schoolId: null,
    firstName: "Super",
    middleName: null,
    lastName: "Admin",
    fullName: email || "Super Admin",
    isActive: true,
    profileCompleted: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

async function selectUserByAuthId(
  client: SupabaseClient,
  authId: string
): Promise<{ user: User | null; error: string | null }> {
  const { data, error } = await client
    .from(USER_TABLE)
    .select(USER_SELECT)
    .eq("authId", authId)
    .maybeSingle();

  if (error) {
    return { user: null, error: error.message };
  }
  if (!data) {
    return { user: null, error: null };
  }
  return { user: mapPostgrestUser(data as PostgrestUserRow), error: null };
}

/**
 * Load public."User" via PostgREST (not Prisma). Tries the session/anon client first,
 * then service-role if available — so SUPER_ADMIN login works when DATABASE_URL is broken.
 */
export async function findUserByAuthIdViaPostgrest(
  authId: string,
  client?: SupabaseClient
): Promise<{ user: User | null; error: string | null }> {
  const supabase = client ?? (await createSupabaseServerClient());
  const first = await selectUserByAuthId(supabase, authId);
  if (first.user) return first;

  // Service role bypasses RLS and does not depend on the cookie session JWT.
  if (getSupabaseServiceEnv().ok) {
    try {
      const admin = createSupabaseAdminClient();
      const viaAdmin = await selectUserByAuthId(admin, authId);
      if (viaAdmin.user || viaAdmin.error) return viaAdmin;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "admin client failed");
      return { user: null, error: first.error ?? message };
    }
  }

  return first;
}

/**
 * Resolve app User by authId. Prefers PostgREST (public."User") so session
 * works when Prisma DATABASE_URL is broken; falls back to Prisma, then
 * SUPER_ADMIN via app_metadata.role only (never user_metadata).
 * Returns null for inactive or soft-deleted users.
 */
export async function findAppUserByAuthId(
  authId: string,
  options?: { authUser?: AuthUser; supabase?: SupabaseClient }
): Promise<User | null> {
  const { user: viaRest } = await findUserByAuthIdViaPostgrest(authId, options?.supabase);
  if (viaRest) {
    return isUsableAppUser(viaRest) ? viaRest : null;
  }

  try {
    const user = await prisma.user.findUnique({ where: { authId } });
    if (user) {
      return isUsableAppUser(user) ? user : null;
    }
  } catch (err) {
    if (!isPrismaConnectionError(err)) throw err;
  }

  if (options?.authUser) {
    return superAdminFromAuthClaims(options.authUser);
  }
  return null;
}
