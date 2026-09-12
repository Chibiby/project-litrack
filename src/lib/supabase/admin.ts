import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceEnv } from "@/lib/supabase/env";
import { AppError } from "@/lib/errors/app-error";

const INVALID_SERVICE_ROLE_MESSAGE =
  "SUPABASE_SERVICE_ROLE_KEY is missing or invalid. In Supabase Dashboard → Project Settings → API, copy the service_role secret (JWT) into .env.local — not the anon key.";

/**
 * Decode a Supabase API JWT payload without verifying the signature.
 * Used only to reject obvious misconfiguration (anon key / placeholders).
 */
export function readSupabaseJwtRole(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function isServiceRoleJwt(key: string): boolean {
  return readSupabaseJwtRole(key) === "service_role";
}

export function getInvalidServiceRoleMessage(): string {
  return INVALID_SERVICE_ROLE_MESSAGE;
}

/**
 * Service-role Supabase client. SERVER ONLY. Never import from client code.
 * Used for: creating auth users, admin operations, bypassing RLS.
 */
export function createSupabaseAdminClient() {
  const env = getSupabaseServiceEnv();
  if (!env.ok) {
    // The setup instructions are admin detail, not user copy: this message
    // names a dashboard, a key and a file, and the person who hit it is usually
    // a teacher who can do nothing with any of that.
    throw new AppError("CONFIG_MISSING", {
      detail: INVALID_SERVICE_ROLE_MESSAGE,
      context: { reason: "service_role_key" },
    });
  }
  if (!isServiceRoleJwt(env.serviceRoleKey)) {
    // The setup instructions are admin detail, not user copy: this message
    // names a dashboard, a key and a file, and the person who hit it is usually
    // a teacher who can do nothing with any of that.
    throw new AppError("CONFIG_MISSING", {
      detail: INVALID_SERVICE_ROLE_MESSAGE,
      context: { reason: "service_role_key" },
    });
  }

  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
