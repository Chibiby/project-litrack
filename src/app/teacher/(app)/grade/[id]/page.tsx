import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface TeacherGradePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Legacy grade index → combined Learners roster with grade filter. */
export default async function TeacherGradePage({
  params,
  searchParams,
}: TeacherGradePageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const next = new URLSearchParams();
  next.set("grade", id);

  for (const [key, raw] of Object.entries(sp)) {
    if (key === "grade") continue;
    const value = firstString(raw);
    if (value) next.set(key, value);
  }

  redirect(`/teacher/learners?${next.toString()}`);
}
