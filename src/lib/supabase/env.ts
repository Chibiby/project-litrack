/**
 * Shared checks for Supabase public/server env.
 * Avoid creating clients with empty URL/key (throws at runtime).
 */

export function getSupabasePublicEnv():
  | { ok: true; url: string; anonKey: string }
  | { ok: false } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return { ok: false };
  return { ok: true, url, anonKey };
}

export function getSupabaseServiceEnv():
  | { ok: true; url: string; serviceRoleKey: string }
  | { ok: false } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return { ok: false };
  return { ok: true, url, serviceRoleKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicEnv().ok;
}

export const SUPABASE_NOT_CONFIGURED_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (and SUPABASE_SERVICE_ROLE_KEY for admin APIs) in Vercel env, then redeploy.";
