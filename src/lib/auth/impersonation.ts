import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseServiceEnv } from "@/lib/supabase/env";

/**
 * Super Admin impersonation ticket.
 *
 * When an admin takes over a School Head session, their own Supabase session
 * cookies are replaced — there is nothing left in the request that says who
 * they were. This module stores that one fact in a separate cookie so
 * "Return to admin" can put the original session back without asking for a
 * password.
 *
 * That cookie is therefore a credential: anything it names gets signed back in
 * as SUPER_ADMIN. A plain readable cookie would be a one-line privilege
 * escalation — set `impersonator=<any admin id>` and become that admin. So the
 * value is HMAC-signed server-side and verified in constant time, and every
 * ticket carries an expiry. A forged or edited cookie fails verification and is
 * treated as absent.
 *
 * The HMAC key is SUPABASE_SERVICE_ROLE_KEY: server-only, high-entropy, and
 * already required for the admin Auth APIs this feature depends on, so there is
 * no new secret to provision or rotate separately. Rotating the service role
 * key invalidates outstanding tickets, which is the correct failure direction —
 * the admin simply signs in again.
 */

const COOKIE_NAME = "litrack_impersonator";

/**
 * Two hours. Long enough to actually diagnose a school's problem, short enough
 * that a forgotten session cannot restore admin access days later.
 */
const TICKET_TTL_MS = 2 * 60 * 60 * 1000;

export type ImpersonationTicket = {
  /** Supabase auth.users.id of the admin to restore. */
  adminAuthId: string;
  /** Prisma User.id of the admin — audit rows key off this. */
  adminUserId: string;
  /** Prisma User.id of the account being impersonated. */
  targetUserId: string;
  /** Epoch ms after which the ticket is refused. */
  expiresAt: number;
};

/**
 * Null when the service role key is unset. Callers must branch rather than
 * throw: `readImpersonationTicket` runs in the School Head layout on every
 * request, so a throw here would take down the whole `/school-head` tree on any
 * deployment missing that key — a config gap turning into a total outage for
 * people who never impersonate anything. Verification without a key is simply
 * impossible, which is the same answer as "this ticket is not valid".
 */
function signingKey(): string | null {
  const env = getSupabaseServiceEnv();
  return env.ok ? env.serviceRoleKey : null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

/** `.`-joined payload; ids are UUIDs so none of them can contain the separator. */
function payloadOf(ticket: ImpersonationTicket): string {
  return [
    ticket.adminAuthId,
    ticket.adminUserId,
    ticket.targetUserId,
    String(ticket.expiresAt),
  ].join(".");
}

/**
 * Constant-time compare that also tolerates length mismatch — `timingSafeEqual`
 * throws on differing lengths, and letting that throw would leak length through
 * the error path.
 */
function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Throws when the key is missing — the caller is starting impersonation and must fail loudly. */
export function encodeImpersonationTicket(
  ticket: Omit<ImpersonationTicket, "expiresAt">,
  now: number = Date.now()
): { value: string; ticket: ImpersonationTicket } {
  const key = signingKey();
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for impersonation.");
  }
  const full: ImpersonationTicket = { ...ticket, expiresAt: now + TICKET_TTL_MS };
  const payload = payloadOf(full);
  return { value: `${payload}.${sign(payload, key)}`, ticket: full };
}

/**
 * Returns null for anything unparseable, unsigned, mis-signed, or expired — and
 * for everything when no signing key is configured.
 */
export function decodeImpersonationTicket(
  value: string | undefined,
  now: number = Date.now()
): ImpersonationTicket | null {
  if (!value) return null;

  const key = signingKey();
  if (!key) return null;

  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [adminAuthId, adminUserId, targetUserId, expiresRaw, signature] = parts;

  const payload = [adminAuthId, adminUserId, targetUserId, expiresRaw].join(".");
  if (!signatureMatches(sign(payload, key), signature)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  return { adminAuthId, adminUserId, targetUserId, expiresAt };
}

export async function setImpersonationCookie(
  ticket: Omit<ImpersonationTicket, "expiresAt">
): Promise<void> {
  const { value, ticket: full } = encodeImpersonationTicket(ticket);
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(full.expiresAt),
  });
}

/**
 * The ticket on the current request, or null. Safe to call from a Server
 * Component: reading cookies never throws there, only writing does.
 */
export async function readImpersonationTicket(): Promise<ImpersonationTicket | null> {
  const store = await cookies();
  return decodeImpersonationTicket(store.get(COOKIE_NAME)?.value);
}

export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
