import { redirect } from "next/navigation";

export default function TeacherPasswordRedirectPage() {
  redirect("/teacher/settings/security");
}
