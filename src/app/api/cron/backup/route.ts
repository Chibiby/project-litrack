import { NextResponse, type NextRequest } from "next/server";
import { createSnapshot } from "@/lib/db/snapshot";
import { isBackupStoreConfigured, saveBackup, type BackupKind } from "@/lib/db/backup-store";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { route } from "@/lib/errors/route";
import { AppError } from "@/lib/errors/app-error";
import { purgeExpiredErrorEvents } from "@/lib/errors/retention";

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

export const GET = route("GET /api/cron/backup", async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    throw new AppError("AUTH_NOT_SIGNED_IN", { detail: "Missing or wrong CRON_SECRET" });
  }

  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: BackupKind = kindParam === "weekly" ? "weekly" : "daily";

  if (!isBackupStoreConfigured()) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      params: { service: "Backup storage" },
      detail: "BLOB_READ_WRITE_TOKEN is not set; no backup store to write to.",
      context: { service: "blob" },
    });
  }

  // A failure here is still logged and still returns non-200 for the cron
  // dashboard — the wrapper does both — but the response no longer echoes the
  // raw error text, which could name tables and values.
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

  // Housekeeping rides on the daily run rather than its own cron entry: one
  // fewer schedule to keep working, and the plan's cron allowance is finite.
  // A failed purge must never fail a backup — the backup is the important half.
  let errorEventsPurged: number | null = null;
  if (kind === "daily") {
    try {
      errorEventsPurged = await purgeExpiredErrorEvents();
    } catch (err) {
      console.error(
        "[cron/backup] ErrorEvent purge failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return NextResponse.json({
    ok: true,
    kind,
    stamp: saved.stamp,
    bytes: saved.size,
    totalRows: snapshot.meta.totalRows,
    errorEventsPurged,
  });
});
