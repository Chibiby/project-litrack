import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { listSchoolsPublic } from "@/lib/actions/school";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";
import { route } from "@/lib/errors/route";
import { tooManyAttempts } from "@/lib/errors/app-error";

// Must stay dynamic: prerendering this at build time requires a reachable
// database, which is not guaranteed in the Vercel build environment.
export const dynamic = "force-dynamic";

/** Soft abuse protection for unauthenticated school enumeration (id + name only). */
const PUBLIC_LIST_RATE = { limit: 60, windowMs: 60_000 };

export const GET = route("GET /api/schools/list", async () => {
  const ip = clientIpFrom(await headers());
  const rate = await checkRateLimit(`api:schools-list:${ip}`, PUBLIC_LIST_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

  // An unreachable database must not masquerade as "there are no schools" —
  // that renders an empty picker on /login and hides the outage entirely. The
  // wrapper turns a throw into a 503 that names the cause and carries a
  // reference, where this used to answer `{ schools: [] }` with a bare string.
  return NextResponse.json({ schools: await listSchoolsPublic() });
});
