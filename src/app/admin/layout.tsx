// Force dynamic so Next doesn't try to statically prerender these auth-gated
// pages at build time, when Supabase/DATABASE_URL env may not be reachable.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
