import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { readBackupBytes, isBackupStoreConfigured } from "@/lib/db/backup-store";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { route } from "@/lib/errors/route";
import { AppError, fieldError, resourceNotFound } from "@/lib/errors/app-error";

/**
 * Streams a stored backup to the admin who asked for it.
 *
 * The blobs are `access: 'private'`, so their storage URLs cannot be handed to
 * a browser — which is the point. A backup file is the complete learner roster
 * of every school; it must only ever leave the system through a request this
 * route has authenticated.
 *
 * `src/middleware.ts` skips `/api/`, so the role check here is the only gate —
 * and it uses `getCurrentUser` rather than `requireUser` because a redirect to
 * a login page is the wrong answer for a file download.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route("GET /api/admin/backups/download", async (request: NextRequest) => {
  // This link is opened by a browser, so `errorResponse` sends a signed-out
  // admin to /admin/login and a wrong role to /forbidden rather than showing
  // them raw JSON.
  const user = await getCurrentUser();
  if (!user) throw new AppError("AUTH_NOT_SIGNED_IN");
  if (user.role !== "SUPER_ADMIN") {
    throw new AppError("AUTH_FORBIDDEN", {
      params: { what: "database backups" },
      detail: `Role ${user.role} requested a backup download`,
      context: { reason: "not_super_admin" },
    });
  }

  if (!isBackupStoreConfigured()) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      params: { service: "Backup storage" },
      context: { service: "blob" },
    });
  }

  const pathname = request.nextUrl.searchParams.get("path");
  if (!pathname) throw fieldError("path", "Which backup? The link is missing its file name.");

  {
    // `readBackupBytes` rejects anything outside the backup layout, so a
    // crafted `path` cannot turn this into a read of an arbitrary blob.
    const bytes = await readBackupBytes(pathname);
    if (!bytes) throw resourceNotFound("Backup");

    await writeAudit({
      userId: user.id,
      action: AUDIT_ACTIONS.DB_BACKUP_DOWNLOAD,
      resource: "Database",
      resourceId: pathname,
      metadata: { bytes: bytes.byteLength },
    });

    const filename = `litrack-${pathname.split("/").slice(-2).join("-")}`;

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${filename}"`,
        // A backup is a point-in-time secret. Nothing between here and the
        // admin's disk should keep a copy.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }
});
