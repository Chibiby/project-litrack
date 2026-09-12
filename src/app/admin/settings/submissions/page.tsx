import { redirect } from "next/navigation";

export default function LegacySubmissionSettingsPage() {
  redirect("/admin/submissions");
}
