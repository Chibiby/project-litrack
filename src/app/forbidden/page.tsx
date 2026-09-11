import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/errors/error-card";
import { peekCurrentUser } from "@/lib/auth/session";
import { roleHomePath } from "@/lib/auth/roles";
import { USER_ROLE_LABELS } from "@/lib/constants/enum-labels";

export const dynamic = "force-dynamic";

/**
 * Reached when a request is refused rather than redirected — today that means an
 * API route opened in a browser, such as a stale backup-download link. Ordinary
 * wrong-role page visits still bounce quietly to the person's own home, so this
 * page is rare by design rather than by accident.
 */
export default async function ForbiddenPage() {
  const user = await peekCurrentUser();
  const home = user ? roleHomePath(user.role) : "/login";

  return (
    <ErrorCard
      icon={ShieldAlert}
      title="You don't have access to this page"
      description={
        user
          ? `You're signed in as ${USER_ROLE_LABELS[user.role]}, which can't open this page. If you think you should have access, ask your administrator.`
          : "Sign in to continue. If you're already signed in on another tab, refresh and try again."
      }
    >
      <Button asChild>
        <Link href={home}>{user ? "Back to your dashboard" : "Sign in"}</Link>
      </Button>
    </ErrorCard>
  );
}
