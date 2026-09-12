import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  isAuthRetryableFetchError,
  type AuthError,
  type SupabaseClient,
} from "@supabase/supabase-js";
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
 *
 * A valid signature is not enough on its own, because the ticket outlives the
 * session it was made for. It names the TARGET, and the target can sign in
 * again on the same browser: before binding, a School Head logging in after an
 * admin clicked "Sign out" instead of "Return to admin" found the banner, and
 * redeeming it signed them in as the Super Admin. User identity cannot tell the
 * session the admin created from a later, independent login by the same person
 * — only session identity can. So every ticket also carries the `session_id`
 * claim of the one Supabase session `impersonateUser` minted, and
 * `endImpersonation` refuses any caller whose verified session is not that
 * one. A re-login is a new session with a new id, and fails.
 *
 * Format change and deploy: the payload grew from four fields to five, so a
 * ticket issued before binding shipped has five dot-separated parts instead of
 * six and decodes to null. That is the fail-closed direction — an admin who was
 * mid-impersonation at deploy loses the banner and the way back, stays signed in
 * as the target, and signs out and back in as themselves. An old ticket can
 * never restore anything.
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
  /**
   * `session_id` claim of the Supabase session `impersonateUser` minted for the
   * target — the only session `endImpersonation` will honour this ticket from.
   * Stable across token refresh, which continues the same session.
   */
  sessionId: string;
  /** Epoch ms after which the ticket is refused. */
  expiresAt: number;
};

export type ImpersonationContext = {
  ticket: ImpersonationTicket;
  /** Redemption is closed, but the bound session still needs warning/sign-out handling. */
  expired: boolean;
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

/**
 * `.`-joined payload. Every id is a UUID, so none can contain the separator —
 * and if one ever did, the ticket would split into the wrong number of parts
 * and `decodeImpersonationTicket` would refuse it, never misread it.
 */
function payloadOf(ticket: ImpersonationTicket): string {
  return [
    ticket.adminAuthId,
    ticket.adminUserId,
    ticket.targetUserId,
    ticket.sessionId,
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
 * Returns null for anything unparseable, unsigned, or mis-signed — and
 * for everything when no signing key is configured.
 */
function decodeSignedTicket(value: string | undefined): ImpersonationTicket | null {
  if (!value) return null;

  const key = signingKey();
  if (!key) return null;

  // Six, not five: a pre-binding ticket (no session id) is refused here, which
  // is what makes the format change fail closed.
  const parts = value.split(".");
  if (parts.length !== 6) return null;
  const [adminAuthId, adminUserId, targetUserId, sessionId, expiresRaw, signature] = parts;

  const payload = [adminAuthId, adminUserId, targetUserId, sessionId, expiresRaw].join(".");
  if (!signatureMatches(sign(payload, key), signature)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt)) return null;

  return { adminAuthId, adminUserId, targetUserId, sessionId, expiresAt };
}

export function decodeImpersonationTicket(
  value: string | undefined,
  now: number = Date.now()
): ImpersonationTicket | null {
  const ticket = decodeSignedTicket(value);
  return ticket && ticket.expiresAt > now ? ticket : null;
}

/**
 * Read a correctly signed ticket even after its redemption deadline. Expiry
 * still blocks `endImpersonation`; this view exists only so the same bound
 * session keeps its warning and receives local-only sign-out handling.
 */
export function decodeImpersonationContext(
  value: string | undefined,
  now: number = Date.now()
): ImpersonationContext | null {
  const ticket = decodeSignedTicket(value);
  return ticket ? { ticket, expired: ticket.expiresAt <= now } : null;
}

export async function setImpersonationCookie(
  ticket: Omit<ImpersonationTicket, "expiresAt">
): Promise<void> {
  const { value } = encodeImpersonationTicket(ticket);
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Session cookie on purpose. The signed `expiresAt` remains the hard limit
    // for returning to admin, while this cookie survives long enough to keep
    // an older impersonation visibly marked and its sign-out local-only.
  });
}

/**
 * The ticket on the current request, or null. Safe to call from a Server
 * Component: reading cookies never throws there, only writing does.
 *
 * Memoized per request with React `cache()` because the school-head and teacher
 * trees now read it twice on every render — once by the layout (release-modal
 * suppression and, for school heads, the profiling bypass) and once by
 * `ImpersonationNotice`. Safe to memoize: the cookie cannot change mid-request
 * except through this module's own writers, and no path here reads the ticket
 * after setting or clearing it.
 */
export const readImpersonationTicket = cache(
  async (): Promise<ImpersonationTicket | null> => {
    const store = await cookies();
    return decodeImpersonationTicket(store.get(COOKIE_NAME)?.value);
  }
);

export const readImpersonationContext = cache(
  async (): Promise<ImpersonationContext | null> => {
    const store = await cookies();
    return decodeImpersonationContext(store.get(COOKIE_NAME)?.value);
  }
);

/**
 * Drop the ticket. Called by `endImpersonation` and by every path that tears a
 * session down, because a ticket left behind after its session ends is exactly
 * the credential the binding above exists to neutralise.
 *
 * A no-op when there is no ticket, and that check is load-bearing: the
 * teardown paths in `getCurrentUser` also run inside Server Components, where
 * Next makes the cookie store read-only and throws on any write. Checking first
 * means that throw only happens when a ticket is actually present, so it is
 * worth the log line those callers write for it.
 */
export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies();
  if (!store.has(COOKIE_NAME)) return;
  store.delete(COOKIE_NAME);
}

// ── Session binding checks ────────────────────────────────────────────────
//
// These live here, not in `@/lib/actions/accounts`, because two modules need
// them — `accounts.ts` to bind and redeem, `auth.ts` to scope a sign-out — and
// `accounts.ts` is a "use server" file: anything it exported would become an
// endpoint a browser could call. This module is `server-only` and is never
// that. None of these grants anything; they only report on a session.

type AuthClient = SupabaseClient["auth"];

/**
 * What the auth server says about a session: `live` with its id and the access
 * token it was read from, `none` when it definitively is not a live session (no
 * session, a token that fails verification, a revoked session, no usable
 * claim), or `unavailable` when the server could not be asked. `none` and
 * `unavailable` must stay apart — `endImpersonation` drops the ticket on the
 * first and keeps it on the second, so a network blip cannot strand an admin.
 */
export type SessionCheck =
  | { status: "live"; sessionId: string; accessToken: string }
  | { status: "none" }
  | { status: "unavailable" };

/** Network failures and auth-server 5xx: no answer, as opposed to a "no". */
function isAuthOutage(error: AuthError): boolean {
  return isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500;
}

/**
 * The `session_id` claim of `jwt`, read through `getClaims` so the SDK both
 * verifies and decodes it. Typed required (`RequiredClaims.session_id` in
 * auth-js) and every GoTrue access token carries it, but it is still checked at
 * runtime: a missing or empty claim is `none`, never a value that could match.
 */
export async function checkSessionToken(auth: AuthClient, jwt: string): Promise<SessionCheck> {
  const { data, error } = await auth.getClaims(jwt);
  if (error) return isAuthOutage(error) ? { status: "unavailable" } : { status: "none" };
  const id: unknown = data?.claims.session_id;
  return typeof id === "string" && id.length > 0
    ? { status: "live", sessionId: id, accessToken: jwt }
    : { status: "none" };
}

/**
 * The session in this request's cookies, only if the auth server still honours
 * it.
 *
 * `getSession` alone is not trusted — it reads cookies the browser controls. Its
 * access token is sent to `getUser`, which the auth server answers only for a
 * validly signed token whose session row still exists (GoTrue refuses anything
 * else with `session_not_found`), so a session revoked by signing out is `none`
 * here even while its token is unexpired. The claim is then read from that same
 * token. A refresh inside `getSession` keeps the id, because refreshing
 * continues the same session.
 */
export async function checkCurrentSession(auth: AuthClient): Promise<SessionCheck> {
  const { data, error: sessionError } = await auth.getSession();
  if (sessionError) {
    return isAuthOutage(sessionError) ? { status: "unavailable" } : { status: "none" };
  }
  const token = data.session?.access_token;
  if (!token) return { status: "none" };

  const { error: userError } = await auth.getUser(token);
  if (userError) return isAuthOutage(userError) ? { status: "unavailable" } : { status: "none" };

  return checkSessionToken(auth, token);
}

/**
 * True only when this request carries a valid ticket AND is the live session
 * that ticket is bound to — i.e. a Super Admin, inside an impersonation, is the
 * one asking. False for everything else, including "could not tell": callers
 * use this to narrow what they do, so the unproven case keeps the default.
 *
 * Costs nothing on a request without a ticket, which is every ordinary one: the
 * auth server is consulted only once a ticket has already verified.
 */
export async function isBoundImpersonationSession(auth: AuthClient): Promise<boolean> {
  return (await readBoundImpersonationSession(auth)) !== null;
}

/** Bound context for UI and sign-out. May be expired for redemption. */
export async function readBoundImpersonationSession(
  auth: AuthClient
): Promise<ImpersonationContext | null> {
  const context = await readImpersonationContext();
  if (!context) return null;
  const current = await checkCurrentSession(auth);
  return current.status === "live" && current.sessionId === context.ticket.sessionId
    ? context
    : null;
}
