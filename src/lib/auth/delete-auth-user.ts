import "server-only";
import { prisma } from "@/lib/prisma";
import {
  createSupabaseAdminClient,
  getInvalidServiceRoleMessage,
  isServiceRoleJwt,
} from "@/lib/supabase/admin";
import { getSupabaseServiceEnv } from "@/lib/supabase/env";

function isAuthUserMissing(message: string | undefined): boolean {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("not found") || msg.includes("user not found");
}

function isInvalidApiKeyError(message: string | undefined): boolean {
  const msg = (message ?? "").toLowerCase();
  return (
    msg.includes("invalid api key") ||
    msg.includes("invalid jwt") ||
    (msg.includes("jwt") && msg.includes("invalid"))
  );
}

/**
 * Remove a Supabase Auth user so the email can be reused (e.g. allow re-register).
 * Prefers the Admin API when SUPABASE_SERVICE_ROLE_KEY is a real service_role JWT;
 * falls back to DELETE on auth.users via DATABASE_URL when the key is missing/invalid
 * (common local misconfig) or Admin returns Invalid API key.
 */
export async function deleteAuthUser(
  authId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const env = getSupabaseServiceEnv();
  const canUseAdmin = env.ok && isServiceRoleJwt(env.serviceRoleKey);

  if (canUseAdmin) {
    try {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.auth.admin.deleteUser(authId);
      if (!error) return { ok: true };
      if (isAuthUserMissing(error.message)) return { ok: true };
      if (!isInvalidApiKeyError(error.message)) {
        return {
          ok: false,
          error: error.message || "Failed to delete auth user",
        };
      }
      // Fall through to SQL for invalid key.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("SUPABASE_SERVICE_ROLE_KEY") && !isInvalidApiKeyError(message)) {
        return { ok: false, error: message || "Failed to delete auth user" };
      }
      // Fall through to SQL.
    }
  }

  try {
    // Prisma parameterizes the UUID string; cast in SQL for auth.users.id type.
    await prisma.$executeRaw`
      DELETE FROM auth.users WHERE id = ${authId}::uuid
    `;
    return { ok: true };
  } catch (err) {
    console.error("[deleteAuthUser] SQL fallback failed:", err);
    return {
      ok: false,
      error: canUseAdmin
        ? "Failed to remove auth account. Please try again or contact support."
        : getInvalidServiceRoleMessage(),
    };
  }
}
