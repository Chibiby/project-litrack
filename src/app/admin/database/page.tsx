import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { DatabaseConsole, type ConsoleData } from "@/components/admin/database-console";
import {
  BACKUP_STORE_SETUP_MESSAGE,
  isBackupStoreConfigured,
  latestSafetyBackup,
  listBackups,
} from "@/lib/db/backup-store";
import { currentCounts } from "@/lib/db/snapshot";
import { accountCounts, accountCountsBySchool } from "@/lib/db/account-reset";
import { EXCLUDED_TABLES } from "@/lib/db/schema-order";

export const dynamic = "force-dynamic";

/**
 * Reads every table's row count and lists the blob store on each load. Neither
 * is cached: this page's whole job is telling an admin what is in the database
 * *right now*, immediately before they act on it, and a 60-second stale count
 * here would be read as the result of the operation they just ran.
 */
export default async function DatabasePage() {
  const user = await requireUser("SUPER_ADMIN");

  const storeReady = isBackupStoreConfigured();

  const [counts, accounts, schools, backups, safety] = await Promise.all([
    currentCounts().catch((err) => {
      console.error("[DatabasePage] counts failed:", err);
      return {} as Record<string, number>;
    }),
    accountCounts().catch(() => ({ schoolHeads: 0, teachers: 0 })),
    // An empty list only costs the Danger zone its school picker, so a failure
    // here must not take the whole page down with it.
    accountCountsBySchool().catch((err) => {
      console.error("[DatabasePage] per-school account counts failed:", err);
      return [];
    }),
    storeReady
      ? listBackups().catch((err) => {
          console.error("[DatabasePage] listing backups failed:", err);
          return [];
        })
      : Promise.resolve([]),
    storeReady ? latestSafetyBackup().catch(() => null) : Promise.resolve(null),
  ]);

  const data: ConsoleData = {
    storeReady,
    storeMessage: BACKUP_STORE_SETUP_MESSAGE,
    counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    accounts,
    schools,
    backups: backups.map((b) => ({
      kind: b.kind,
      pathname: b.pathname,
      stamp: b.stamp,
      size: b.size,
      uploadedAt: b.uploadedAt.toISOString(),
    })),
    safety: safety
      ? {
          kind: safety.kind,
          pathname: safety.pathname,
          stamp: safety.stamp,
          size: safety.size,
          uploadedAt: safety.uploadedAt.toISOString(),
        }
      : null,
  };

  return (
    <AppShell
      title="Database"
      subtitle="Backups, restore, and system-wide resets"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mb-4 rounded-xl border border-border/80 bg-muted/40 px-4 py-3 text-sm">
        <p className="font-medium">What these backups are</p>
        <p className="mt-1 text-muted-foreground">
          Each backup is a complete copy of the data in every school, taken through the app and
          stored privately outside the database. It captures data, not schema — a backup taken
          before a migration will not restore onto a changed table, and will refuse rather than
          restore halfway. For hardware-level disaster recovery, Supabase&rsquo;s own
          point-in-time restore is still the right tool. These files contain learner personal
          information: a download leaves the system&rsquo;s protection and becomes your
          responsibility to store and dispose of.
        </p>
        <p className="mt-2 text-muted-foreground">
          Not included, on purpose: <code>{EXCLUDED_TABLES.join(", ")}</code> — an out-of-band
          Google-Sheets sync subsystem with no model in this app, one of whose columns holds a
          plaintext API key. Backups skip it and resets leave it alone.
        </p>
      </div>

      <DatabaseConsole data={data} />
    </AppShell>
  );
}
