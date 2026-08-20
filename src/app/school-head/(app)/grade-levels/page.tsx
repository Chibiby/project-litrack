import { redirect } from "next/navigation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/**
 * Moved into the School workspace. See the note on the school-years stub.
 *
 * This one carries the most traffic of the three: teacher-facing emails and the
 * `sections` stub both pointed here.
 */
export default async function LegacyGradeLevelsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const qs = params.schoolId
    ? `?schoolId=${encodeURIComponent(params.schoolId)}`
    : "";
  redirect(`${SCHOOL_HEAD_ROUTES.schoolGradeLevels}${qs}`);
}
