import { redirect } from "next/navigation";
import { DISTRICT_ROUTES } from "@/lib/routes/district";

export default function DistrictSettingsIndexPage() {
  redirect(DISTRICT_ROUTES.settingsProfile);
}
