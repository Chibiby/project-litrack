import "server-only";
import { headers } from "next/headers";
import { checkRateLimit, peekRateLimit } from "@/lib/rate-limit";
import { tooManyAttempts } from "@/lib/errors/app-error";
import { clientIpFrom } from "@/lib/request-ip";

/**
 * Makes guessing which email addresses exist expensive, without making signing
 * in expensive.
 *
 * The sign-in form answers "no teacher account uses this email at this school",
 * which is genuinely useful — it is the difference between a typo and a missing
 * account. The existing limiter could not meter that answer, because its key
 * includes the email: every guessed address arrived with a fresh allowance of
 * ten, so the limit never bound a list of guesses at all.
 *
 * This one is keyed on the address the request came from, and is charged ONLY
 * when a lookup failed. Teachers typing their own correct addresses never spend
 * it, so a computer lab behind one school NAT address is never locked out; a
 * script working through a list spends one per guess. Once over the limit,
 * every lookup from that address is refused — including the ones that would
 * have succeeded, because a block that only applies to misses still answers the
 * question being asked.
 */

export const LOOKUP_FAILURE_RATE = { limit: 10, windowMs: 10 * 60 * 1000 } as const;

async function lookupKey(): Promise<string> {
  return `login:lookup-miss:ip:${clientIpFrom(await headers())}`;
}

/** Call before an account lookup. Throws `AUTH_TOO_MANY_ATTEMPTS` when spent. */
export async function assertLookupAllowed(): Promise<void> {
  const gate = await peekRateLimit(await lookupKey(), LOOKUP_FAILURE_RATE);
  if (!gate.ok) throw tooManyAttempts(gate.retryAfterMs);
}

/** Call when a lookup found no usable account, or hit a registration conflict. */
export async function recordFailedLookup(): Promise<void> {
  await checkRateLimit(await lookupKey(), LOOKUP_FAILURE_RATE);
}
