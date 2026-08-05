import { NextResponse } from "next/server";
import { listSchoolsPublic } from "@/lib/actions/school";

// Must stay dynamic: prerendering this at build time requires a reachable
// database, which is not guaranteed in the Vercel build environment.
export const dynamic = "force-dynamic";

export async function GET() {
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
