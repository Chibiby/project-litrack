import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function createSupabaseServerClient() {
  // Must touch cookies() before any env throw so Next marks the route dynamic
  // and does not try to statically prerender auth-gated pages at build time.
  const cookieStore = await cookies();

  const env = getSupabasePublicEnv();
  if (!env.ok) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component (read-only). Middleware refreshes sessions.
        }
      },
    },
  });
}
