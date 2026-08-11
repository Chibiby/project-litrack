import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface AralDashboardProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Legacy ARAL grade index → combined ARAL dashboard with grade filter. */
export default async function AralGradeRedirectPage({
  params,
  searchParams,
}: AralDashboardProps) {
  const { gradeId } = await params;
  const sp = await searchParams;
  const next = new URLSearchParams();
  next.set("grade", gradeId);

  for (const [key, raw] of Object.entries(sp)) {
    if (key === "grade") continue;
    const value = firstString(raw);
    if (value) next.set(key, value);
  }

  redirect(`/teacher/aral?${next.toString()}`);
}
