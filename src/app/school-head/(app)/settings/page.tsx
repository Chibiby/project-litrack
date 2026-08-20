import { redirect } from "next/navigation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

export default function SchoolHeadSettingsIndexPage() {
  redirect(SCHOOL_HEAD_ROUTES.settingsProfile);
}
