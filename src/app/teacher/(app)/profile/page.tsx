import { redirect } from "next/navigation";

export default function TeacherProfileRedirectPage() {
  redirect("/teacher/settings/profile");
}
