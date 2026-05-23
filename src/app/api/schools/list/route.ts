import { NextResponse } from "next/server";
import { listSchoolsPublic } from "@/lib/actions/school";

export const revalidate = 60; // cache 1 min

export async function GET() {
  const schools = await listSchoolsPublic();
  return NextResponse.json({ schools });
}
