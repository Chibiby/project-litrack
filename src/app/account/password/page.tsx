import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { rolePasswordPath } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Legacy URL: keep bookmarks working, but land inside the role segment so
 * RoleShell (sidebar + header) is not torn down / remounted.
 */
export default async function ChangePasswordPage() {
  const user = await requireUser();
  redirect(rolePasswordPath(user.role));
}
