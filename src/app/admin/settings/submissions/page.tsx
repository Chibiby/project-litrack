import { requireUser } from "@/lib/auth/session";
import { isMonthlyReadingLevelUnlockedForAll, isSubmissionLockingEnabled } from "@/lib/settings/system-settings";
import {
  ReadingLevelUnlockSettings,
  SubmissionLockingSettings,
} from "@/components/admin/submission-locking-settings";
import { UnlockConsole } from "@/components/admin/unlock-console";
import { listActiveUnlocks, listUnlockTargets } from "@/lib/unlock/admin-queries";

export const dynamic = "force-dynamic";

/**
 * Uncached, like the demo settings page and for the same reason: this page's
 * whole job is to say what is switched on and what is open *right now*,
 * immediately before an admin changes it. A stale read here would be mistaken
 * for the result of the action they just took.
 */
export default async function AdminSubmissionSettingsPage() {
  await requireUser("SUPER_ADMIN");

  const [lockingEnabled, readingLevelUnlockedForAll, active, schools] = await Promise.all([
    isSubmissionLockingEnabled(),
    isMonthlyReadingLevelUnlockedForAll(),
    listActiveUnlocks(),
    listUnlockTargets(),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <SubmissionLockingSettings enabled={lockingEnabled} />
      <ReadingLevelUnlockSettings enabled={readingLevelUnlockedForAll} />
      <UnlockConsole schools={schools} active={active} />
    </div>
  );
}
