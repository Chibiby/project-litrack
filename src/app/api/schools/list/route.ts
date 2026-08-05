import { NextResponse } from "next/server";
import { listSchoolsPublic } from "@/lib/actions/school";

// Must stay dynamic: prerendering this at build time requires a reachable
// database, which is not guaranteed in the Vercel build environment.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const schools = await listSchoolsPublic();
    return NextResponse.json({ schools });
  } catch {
    return NextResponse.json({ schools: [] });
  }
}
