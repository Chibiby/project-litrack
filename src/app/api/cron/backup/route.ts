import { NextResponse, type NextRequest } from "next/server";
import { createSnapshot } from "@/lib/db/snapshot";
import { isBackupStoreConfigured, saveBackup, type BackupKind } from "@/lib/db/backup-store";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { route } from "@/lib/errors/route";
import { AppError } from "@/lib/errors/app-error";
import { purgeExpiredErrorEvents } from "@/lib/errors/retention";

/**
 * Scheduled backup endpoint, driven by the `triggers.crons` entries in
 * `wrangler.jsonc` and dispatched by the Worker's scheduled() handler in
 * `worker.js`.
 *
 * `src/middleware.ts` returns early for every `/api/` path, so no session is
 * attached here and this route is responsible for its own authorization. The
 * Worker sends `Authorization: Bearer $CRON_SECRET` on scheduled runs; without
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

  // Housekeeping runs BEFORE the snapshot, not after it.
  //
  // It used to ride on the tail of a successful backup, which meant a snapshot
  // that could not complete also silently stopped `ErrorEvent` retention. That
  // is exactly the situation on Cloudflare today: the snapshot loads every
  // table into one isolate and exceeds the Worker memory limit, so nothing past
  // it ran. The two jobs are independent, so order them that way.
  //
  // A failed purge must still never fail a backup.
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

  return NextResponse.json({
    ok: true,
    kind,
    stamp: saved.stamp,
    bytes: saved.size,
    totalRows: snapshot.meta.totalRows,
    errorEventsPurged,
  });
});
