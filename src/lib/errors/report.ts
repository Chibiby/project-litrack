import "server-only";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppError } from "./app-error";
import { currentErrorScope } from "./context";
import { sendErrorAlert } from "./alert";

/**
 * Record a failure for admins. Returns the reference synchronously; the log line
 * is written now, the ErrorEvent row and any alert after the response.
 *
 * Never throws, and every step is guarded on its own. An error path that can
 * itself fail is how the original error gets lost — and the console line comes
 * first deliberately, because it survives a database outage, which is exactly
 * when the table cannot be written and when someone most needs the record.
 */

export type ReportInput = {
  route?: string;
  routeType?: string;
  method?: string;
  /** Use this reference instead of generating one (page errors use Next's digest). */
  ref?: string;
  userId?: string | null;
  schoolId?: string | null;
  /** Supabase auth id, resolved to a user after the response. Attribution only. */
  authId?: string | null;
  userSource?: "session" | "cookie";
};

/** Crockford base32: no I, L, O or U, so a reference read aloud survives. */
const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `E-${Array.from(bytes, (b) => REF_ALPHABET[b % 32]).join("")}`;
}

/**
 * The only context keys ever stored. Everything else a thrower attaches is
 * dropped, so a stray `email` or `password` can never reach the table — which
 * two UIs read back.
 */
export const ERROR_CONTEXT_KEYS = new Set([
  "prismaCode",
  "prismaError",
  "supabaseCode",
  "supabaseStatus",
  "retryAfterSeconds",
  "resource",
  "crossTenant",
  "reason",
  "schoolId",
  "digest",
  "userSource",
  "service",
]);

type EventRow = {
  ref: string;
  code: string;
  severity: string;
  message: string;
  stack: string | null;
  route: string | null;
  routeType: string | null;
  method: string | null;
  userId: string | null;
  schoolId: string | null;
  context: Record<string, unknown>;
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function adminMessage(err: AppError): string {
  const cause =
    err.cause instanceof Error ? err.cause.message : typeof err.cause === "string" ? err.cause : "";
  const parts = [err.detail, cause].filter((p): p is string => Boolean(p && p.trim()));
  return truncate([...new Set(parts)].join(" | ") || err.message, 2000);
}

function adminStack(err: AppError): string | null {
  const stack = err.cause instanceof Error && err.cause.stack ? err.cause.stack : err.stack;
  return stack ? truncate(stack, 8000) : null;
}

function safeContext(err: AppError, input: ReportInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(err.context)) {
    if (ERROR_CONTEXT_KEYS.has(key)) out[key] = value;
  }
  if (input.userSource) out.userSource = input.userSource;
  if (input.ref && input.routeType && input.routeType !== "action") out.digest = input.ref;
  return out;
}

function logLine(row: EventRow): void {
  try {
    console.error(
      JSON.stringify({
        tag: "litrack.error",
        ...row,
        stack: row.stack?.split("\n").slice(0, 6).join("\n") ?? null,
      })
    );
  } catch {
    // A console replaced by a log forwarder must not fail the request.
  }
}

async function persist(row: EventRow, authId: string | null): Promise<void> {
  let { userId, schoolId } = row;
  try {
    if (!userId && authId) {
      const user = await prisma.user.findUnique({
        where: { authId },
        select: { id: true, schoolId: true },
      });
      userId = user?.id ?? null;
      schoolId = schoolId ?? user?.schoolId ?? null;
    }
    await prisma.errorEvent.create({
      data: { ...row, userId, schoolId, context: row.context as Prisma.InputJsonValue },
    });
  } catch (insertErr) {
    // Includes the window where the code is deployed but the migration has not
    // been applied: the table is missing, and the log line above is the record.
    console.error(
      "[errors] ErrorEvent insert failed:",
      insertErr instanceof Error ? insertErr.message : insertErr
    );
  }

  if (row.severity === "system") {
    await sendErrorAlert({
      ref: row.ref,
      code: row.code,
      route: row.route,
      schoolId,
      summary: row.message,
      at: new Date(),
    });
  }
}

/** Same contract as `deferOrRun` in `@/lib/audit`: queue after the response, or run now. */
function deferOrRun(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

export function reportError(err: AppError, input: ReportInput = {}): string {
  const scope = currentErrorScope();
  const ref = input.ref ?? newReference();
  try {
    const contextSchool = typeof err.context.schoolId === "string" ? err.context.schoolId : null;
    const row: EventRow = {
      ref,
      code: err.code,
      severity: err.severity,
      message: adminMessage(err),
      stack: adminStack(err),
      route: input.route ?? scope?.route ?? null,
      routeType: input.routeType ?? (scope ? "action" : null),
      method: input.method ?? null,
      userId: input.userId ?? scope?.userId ?? null,
      schoolId: input.schoolId ?? scope?.schoolId ?? contextSchool,
      context: safeContext(err, input),
    };
    logLine(row);
    deferOrRun(() => persist(row, input.authId ?? null));
  } catch (reportErr) {
    console.error("[errors] reportError failed:", reportErr);
  }
  return ref;
}
