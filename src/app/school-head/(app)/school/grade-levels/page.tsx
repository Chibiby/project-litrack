import { redirect } from "next/navigation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/**
 * Descriptive alias for the workspace root, which serves the grade-levels panel
 * itself. Kept so the guessable URL resolves rather than 404s.
 */
export default async function GradeLevelsAliasPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const qs = params.schoolId
    ? `?schoolId=${encodeURIComponent(params.schoolId)}`
    : "";
  redirect(`${SCHOOL_HEAD_ROUTES.schoolGradeLevels}${qs}`);
}
