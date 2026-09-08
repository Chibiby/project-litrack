import { NextResponse, type NextRequest } from "next/server";
import { createSnapshot } from "@/lib/db/snapshot";
import { isBackupStoreConfigured, saveBackup, type BackupKind } from "@/lib/db/backup-store";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

/**
 * Scheduled backup endpoint, driven by the `crons` entries in `vercel.json`.
 *
 * `src/middleware.ts` returns early for every `/api/` path, so no session is
 * attached here and this route is responsible for its own authorization. Vercel
 * sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations; without
 * that check the endpoint would be an unauthenticated way for anyone to force
 * repeated full-database reads.
 */

export const dynamic = "force-dynamic";
/** Reads every table; well past the default but inside the 300s platform ceiling. */
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  // Fail closed. An unset secret must not mean "allow everyone" — that is the
  // difference between a misconfiguration and an open endpoint.
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: BackupKind = kindParam === "weekly" ? "weekly" : "daily";

  if (!isBackupStoreConfigured()) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not set; no backup store to write to." },
      { status: 503 }
    );
  }

  try {
    const snapshot = await createSnapshot();
    const saved = await saveBackup(kind, snapshot);

    await writeAudit({
      action: AUDIT_ACTIONS.DB_BACKUP_CREATE,
      resource: "Database",
      resourceId: saved.pathname,
      metadata: {
        trigger: "cron",
        kind,
        totalRows: snapshot.meta.totalRows,
        bytes: saved.size,
      },
    });

    return NextResponse.json({
      ok: true,
      kind,
      stamp: saved.stamp,
      bytes: saved.size,
      totalRows: snapshot.meta.totalRows,
    });
  } catch (err) {
    // Logged rather than swallowed: a silently failing backup job is the worst
    // possible outcome here, so this surfaces in Vercel's function logs and as
    // a non-200 the cron dashboard shows as failed.
    console.error(`[cron/backup] ${kind} backup failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backup failed" },
      { status: 500 }
    );
  }
}
