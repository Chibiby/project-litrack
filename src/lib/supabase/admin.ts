import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceEnv } from "@/lib/supabase/env";

/**
 * Service-role Supabase client. SERVER ONLY. Never import from client code.
 * Used for: creating auth users, admin operations, bypassing RLS.
 */
export function createSupabaseAdminClient() {
  const env = getSupabaseServiceEnv();
  if (!env.ok) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
