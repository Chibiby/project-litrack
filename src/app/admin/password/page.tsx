import { redirect } from "next/navigation";

export default function AdminPasswordRedirectPage() {
  redirect("/admin/settings/security");
}
