import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { readBackupBytes, isBackupStoreConfigured } from "@/lib/db/backup-store";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

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

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (!isBackupStoreConfigured()) {
    return NextResponse.json({ error: "Backup storage is not connected." }, { status: 503 });
  }

  const pathname = request.nextUrl.searchParams.get("path");
  if (!pathname) {
    return NextResponse.json({ error: "Missing backup path" }, { status: 400 });
  }

  try {
    // `readBackupBytes` rejects anything outside the backup layout, so a
    // crafted `path` cannot turn this into a read of an arbitrary blob.
    const bytes = await readBackupBytes(pathname);
    if (!bytes) {
      return NextResponse.json({ error: "That backup is no longer in storage." }, { status: 404 });
    }

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
  } catch (err) {
    console.error("[backups/download] failed:", err);
    return NextResponse.json({ error: "Could not read that backup." }, { status: 500 });
  }
}
