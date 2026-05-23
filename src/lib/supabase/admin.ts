import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. SERVER ONLY. Never import from client code.
 * Used for: creating auth users, admin operations, bypassing RLS.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
