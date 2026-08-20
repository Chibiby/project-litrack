import { redirect } from "next/navigation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/** Legacy path kept so old bookmarks resolve instead of 404ing. */
export default function SchoolHeadProfileRedirectPage() {
  redirect(SCHOOL_HEAD_ROUTES.settingsProfile);
}
