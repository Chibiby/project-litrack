import { redirect } from "next/navigation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/** Moved into the School workspace. See the note on the school-years stub. */
export default async function LegacySchoolInfoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const qs = params.schoolId
    ? `?schoolId=${encodeURIComponent(params.schoolId)}`
    : "";
  redirect(`${SCHOOL_HEAD_ROUTES.schoolInfo}${qs}`);
}
