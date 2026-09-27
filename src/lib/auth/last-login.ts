import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Stamp `User.lastLoginAt` after a successful sign-in. Best-effort: a failure
 * is logged and never fails the login.
 *
 * This replaced the `LOGIN_SUCCESS` audit row (owner decision 2026-09-27:
 * `AuditLog` keeps security records only), so it inherits that row's cost
 * profile — the write is handed to `after()` and runs once the response has
 * been sent, falling back to running inline when `after()` refuses (outside a
 * request scope). Same reasoning as `deferOrRun` in `@/lib/audit`: every throw
 * `after()` can raise happens before anything is enqueued, so the fallback can
 * never double-write.
 *
 * The timestamp is taken now, at the moment of sign-in, not when the deferred
 * write eventually runs.
 */
export async function recordLastLogin(userId: string): Promise<void> {
  const at = new Date();
  const write = async (): Promise<void> => {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: at },
        select: { id: true },
      });
    } catch (err) {
      console.error("[login] lastLoginAt update failed:", err);
    }
  };
  try {
    after(write);
  } catch {
    await write();
  }
}
