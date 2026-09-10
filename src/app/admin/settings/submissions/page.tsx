import { requireUser } from "@/lib/auth/session";
import { isSubmissionLockingEnabled } from "@/lib/settings/system-settings";
import { SubmissionLockingSettings } from "@/components/admin/submission-locking-settings";

export const dynamic = "force-dynamic";

/**
 * Uncached, like the demo settings page and for the same reason: this page's
 * whole job is to say what the switch is set to *right now*, immediately before
 * an admin changes it. A stale read here would be mistaken for the result of the
 * action they just took.
 */
export default async function AdminSubmissionSettingsPage() {
  await requireUser("SUPER_ADMIN");

  return <SubmissionLockingSettings enabled={await isSubmissionLockingEnabled()} />;
}
