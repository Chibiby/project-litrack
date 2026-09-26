import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { backUpDatabase } from "@/lib/db/snapshot";
import { isBackupStoreConfigured, type BackupKind } from "@/lib/db/backup-store";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { route } from "@/lib/errors/route";
import { AppError } from "@/lib/errors/app-error";
import { purgeExpiredErrorEvents } from "@/lib/errors/retention";
import { runDailyRetention, type RetentionReport } from "@/lib/retention/purge";

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

  const header = request.headers.get("authorization");
  if (!header) return false;

  // Constant-time compare. SHA-256 both sides first so the two buffers
  // handed to timingSafeEqual are always 32 bytes each — that sidesteps the
  // length check `timingSafeEqual` would otherwise need (and the throw on
  // mismatched lengths that check exists to avoid).
  const expectedDigest = createHash("sha256").update(`Bearer ${secret}`).digest();
  const receivedDigest = createHash("sha256").update(header).digest();
  return timingSafeEqual(expectedDigest, receivedDigest);
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
  // that could not complete also silently stopped retention. The jobs are
  // independent, so order them that way — and purging first also means the
  // snapshot does not spend time and space on rows about to be deleted.
  //
  // A failed purge must still never fail a backup: each purge swallows its own
  // failure (runDailyRetention reports `failed` per rule).
  let errorEventsPurged: number | null = null;
  let retention: RetentionReport | null = null;
  if (kind === "daily") {
    try {
      errorEventsPurged = await purgeExpiredErrorEvents();
    } catch (err) {
      console.error(
        "[cron/backup] ErrorEvent purge failed:",
        err instanceof Error ? err.message : err
      );
    }
    retention = await runDailyRetention();
    // Counts only. Workers Logs is where "is retention keeping up?" gets
    // answered, so the line is written whether or not the backup succeeds.
    console.log("[cron/backup] retention", JSON.stringify({ errorEventsPurged, ...retention }));
  }

  // A failure here is still logged and still returns non-200 for the cron
  // dashboard — the wrapper does both — but the response no longer echoes the
  // raw error text, which could name tables and values.
  const { saved, totalRows } = await backUpDatabase(kind);

  await writeAudit({
    action: AUDIT_ACTIONS.DB_BACKUP_CREATE,
    resource: "Database",
    resourceId: saved.pathname,
    metadata: {
      trigger: "cron",
      kind,
      totalRows,
      bytes: saved.size,
    },
  });

  return NextResponse.json({
    ok: true,
    kind,
    stamp: saved.stamp,
    bytes: saved.size,
    totalRows,
    errorEventsPurged,
    retention,
  });
});
