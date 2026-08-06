import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { listSchoolsPublic } from "@/lib/actions/school";
import { checkRateLimit } from "@/lib/rate-limit";

// Must stay dynamic: prerendering this at build time requires a reachable
// database, which is not guaranteed in the Vercel build environment.
export const dynamic = "force-dynamic";

/** Soft abuse protection for unauthenticated school enumeration (id + name only). */
const PUBLIC_LIST_RATE = { limit: 60, windowMs: 60_000 };

export async function GET() {
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "unknown";
  const rate = checkRateLimit(`api:schools-list:${ip}`, PUBLIC_LIST_RATE);
  if (!rate.ok) {
    return NextResponse.json(
      { schools: [], error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000) || 1) },
      }
    );
  }

  try {
    const schools = await listSchoolsPublic();
    return NextResponse.json({ schools });
  } catch (error) {
    // An unreachable database must not masquerade as "there are no schools" —
    // that renders an empty picker on /login and hides the outage entirely.
    console.error("[/api/schools/list] school lookup failed", error);
    return NextResponse.json(
      { schools: [], error: "Database unavailable" },
      { status: 503 },
    );
  }
}
