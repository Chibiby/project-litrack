import { NextResponse } from "next/server";
import { listSchoolsPublic } from "@/lib/actions/school";

// Must stay dynamic: Prisma needs DATABASE_URL at request time, not build/prerender.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const schools = await listSchoolsPublic();
  return NextResponse.json({ schools });
}
