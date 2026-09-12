import "server-only";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import type { AuditAction } from "@/lib/audit-actions";

/**
 * Audit logging helper.
 *
 * NEVER put passwords, tokens, credentials, invite secrets, or other secrets
 * in `metadata`. Log resource IDs and non-sensitive context only.
 *
 * `AUDIT_ACTIONS` itself lives in `./audit-actions.ts`, a side-effect-free
 * module with no `server-only`/Next/Prisma imports, so standalone CLI
 * scripts under `scripts/**` (run with `tsx`, not webpacked) can import the
 * action names without pulling in this file's `server-only` guard.
 */

export { AUDIT_ACTIONS };
export type { AuditAction };

export type AuditEntry = {
  userId?: string | null;
  schoolId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Insert an AuditLog row. Failures are logged and never thrown.
 *
 * The insert is dispatched through `after()`, so the caller no longer pays a
 * database round trip on the response path. `writeAudit` itself is still
 * *called* synchronously by its caller, so every `await writeAudit(...)` call
 * site keeps its existing shape and its ordering relative to the rest of the
 * action; only the write moves.
 *
 * Known consequence of that move, bounded and self-healing, and now narrowed to
 * one reader. `AuditLog` has exactly one cached reader:
 * `getAdminActivitySeries` in `src/lib/dashboard/aggregates.ts`, on
 * `profile: "aggregate"` and tagged `adminDashboard`. Grep for both access styles
 * before trusting that count — it reaches the table through `$queryRaw` with
 * `"AuditLog"` in a SQL string, so a `prisma.auditLog` grep does not find it. For
 * that tag: a mutating action busts it *during* the request while the row lands
 * *after* the response, so a render landing between the two can cache a result
 * short by that row for the profile's TTL. No row is lost and no tenancy boundary
 * moves; it clears on the next tag bust or at TTL expiry. It is tolerable there
 * because the value is a seven-day, day-bucketed count series on a bar chart.
 *
 * `getSchoolHeadRecentActivity` used to be the second such reader and no longer
 * is: its audit slice was deliberately moved outside `cachedQuery` (see the
 * comment on that function), because a rail whose job is to say what just happened
 * is the one place this skew is visible.
 *
 * The two `/audit` viewer pages are `force-dynamic` and uncached, so they are
 * unaffected.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await deferOrRun(() => insertOneRow(entry));
}

/**
 * Insert N AuditLog rows in a single statement.
 *
 * Use this instead of `await writeAudit(...)` in a loop. Deferring N per-row
 * inserts individually would be worse than the serial loop it replaces:
 * `after()`'s callback queue is built with no options, so its concurrency is
 * `Infinity` and all N writes fire at once against a pool whose
 * `connection_limit` is floored at 3 (`src/lib/db-url.ts`) — the overflow times
 * out as P2024 after the response has already been sent, and the rows are lost.
 * One `createMany` per call site keeps the fan-out at one and turns N round
 * trips into one.
 */
export async function writeAuditMany(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await deferOrRun(() => insertManyRows(entries));
}

/** AuditLog has no relations, so one row shape serves `create` and `createMany`. */
function toRowData(entry: AuditEntry): Prisma.AuditLogCreateManyInput {
  return {
    userId: entry.userId ?? null,
    schoolId: entry.schoolId ?? null,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    metadata: (entry.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
  };
}

async function insertOneRow(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: toRowData(entry) });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}

async function insertManyRows(entries: AuditEntry[]): Promise<void> {
  try {
    await prisma.auditLog.createMany({ data: entries.map(toRowData) });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}

/**
 * Hand `write` to `after()` so it runs once the response has been flushed, and
 * run it inline when `after()` refuses.
 *
 * The property the fallback depends on is **not** the list of things `after()`
 * can throw — it is that every one of them is raised *synchronously, before
 * anything is enqueued*. `callbackQueue.add` is the last statement on the path,
 * so a throw means the task was never queued and catch-and-run-inline cannot
 * double-write. That is why the `catch` is bare: do not narrow it to specific
 * error codes. The known throws are examples, not a closed set — E468 (called
 * outside a request scope: scripts, unit tests), E91 (`waitUntil` unavailable on
 * the host), E50 (task is neither a promise nor a function, which we avoid by
 * construction), E563 (`waitUntil` already awaited) and a bare `TypeError` when
 * a work store carries no `afterContext`. Any future addition upstream of the
 * enqueue is handled by the same catch for free.
 *
 * The fallback *runs* the write rather than dropping it: AuditLog is a PH Data
 * Privacy Act artifact, and permanently losing a row is strictly worse than the
 * round trip the deferral saves. `write` owns its own try/catch and logs
 * `[audit] write failed:`, so this never throws on either path and Next's
 * `onTaskError` never sees an audit failure.
 */
function deferOrRun(write: () => Promise<void>): Promise<void> {
  try {
    after(write);
  } catch {
    return write();
  }
  return Promise.resolve();
}
