import { redirect } from "next/navigation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/**
 * Soft-deprecated: sections are managed under Grade Levels.
 *
 * Points straight at the new grade-levels path rather than at the stub that
 * replaced the old one — chaining two redirects would double the round trip.
 */
export default async function SectionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const qs = params.schoolId
    ? `?schoolId=${encodeURIComponent(params.schoolId)}`
    : "";
  redirect(`${SCHOOL_HEAD_ROUTES.schoolGradeLevels}${qs}`);
}
