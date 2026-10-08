import { redirect } from "next/navigation";
import { SCHOOL_HEAD_LEGACY_ROUTES } from "@/lib/routes/school-head";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/**
 * Retired: transfers, transfer requests and Change grade all start from a
 * learner's row on the Learners page. Kept as a redirect so bookmarks and a
 * Super Admin's `?schoolId=` link still land somewhere useful.
 */
export default async function TransferPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const qs = params.schoolId
    ? `?schoolId=${encodeURIComponent(params.schoolId)}`
    : "";
  redirect(`${SCHOOL_HEAD_LEGACY_ROUTES["/school-head/transfer"]}${qs}`);
}
