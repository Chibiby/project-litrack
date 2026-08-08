import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/** Soft-deprecated: sections are managed under Grade Levels. */
export default async function SectionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const qs = params.schoolId
    ? `?schoolId=${encodeURIComponent(params.schoolId)}`
    : "";
  redirect(`/school-head/grade-levels${qs}`);
}
