import { redirect } from "next/navigation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/**
 * Moved into the School workspace. Kept as a forward so bookmarks, older
 * announcement links and anything a Super Admin copied out of the address bar
 * still resolve — `?schoolId=` is carried through, without which an admin would
 * land on the school picker instead of the school they were looking at.
 */
export default async function LegacySchoolYearsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const qs = params.schoolId
    ? `?schoolId=${encodeURIComponent(params.schoolId)}`
    : "";
  redirect(`${SCHOOL_HEAD_ROUTES.schoolYears}${qs}`);
}
