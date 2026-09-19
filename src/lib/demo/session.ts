import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { getSupabaseServiceEnv } from "@/lib/supabase/env";

/**
 * The demo session: who is allowed to see the training tenant, and for how long.
 *
 * The demo district and its schools used to be governed by one global setting
 * row (`demo.enabled`). Global is the wrong scope: switching it on to record a
 * walkthrough put "[demo district]" and "[demo school 1]" in the District and
 * School dropdowns of every real teacher's login page, and left them there
 * until somebody remembered to switch it back off. Real schools must never see
 * the training data, not even briefly.
 *
 * So visibility is per browser, not per deployment. A Super Admin opens a demo
 * session from `/admin/settings/demo`; that writes this cookie, and only a
 * request carrying it sees demo schools anywhere — the login dropdowns, the
 * public schools API, the admin dashboard counts — or is allowed to sign in to
 * one. Every other visitor sees the system exactly as if the demo tenant did
 * not exist.
 *
 * The cookie is therefore a capability, so it is HMAC-signed and verified in
 * constant time, exactly like the impersonation ticket next door
 * (`@/lib/auth/impersonation`), and for the same reason: a plain readable
 * `demo=1` would let anyone reveal the training tenant by editing a cookie. It
 * grants no role and no account — the worst a forged one could do is show three
 * fake schools — but it is still the difference between "admins only" and
 * "anybody", which is the whole of what was asked for.
 *
 * The signing key is SUPABASE_SERVICE_ROLE_KEY: server-only, high-entropy, and
 * already required by the admin surfaces that start a demo session. Rotating it
 * ends outstanding demo sessions, which is the correct failure direction.
 *
 * It is a browser-session cookie with a signed expiry on top. Closing the
 * browser ends it, `logoutAction` clears it, and `expiresAt` caps a forgotten
 * one — the demo never outlives the sitting it was opened for.
 */

const COOKIE_NAME = "litrack_demo";

/**
 * Four hours. Long enough for a recording session or a training workshop,
 * short enough that a laptop left open overnight is not still showing the demo
 * tenant the next morning.
 */
const DEMO_TTL_MS = 4 * 60 * 60 * 1000;

export type DemoSession = {
  /** Prisma `User.id` of the Super Admin who opened it. Audit rows key off this. */
  adminUserId: string;
  /** Epoch ms after which the session is refused. */
  expiresAt: number;
};

/**
 * Null when the service role key is unset. Readers must treat that as "no demo
 * session" rather than throwing: `isDemoVisible` runs on `/login`, the page
 * every user starts from, and a missing key must not take it down. Being unable
 * to verify a cookie and the cookie being invalid have the same answer here —
 * hide the demo.
 */
function signingKey(): string | null {
  const env = getSupabaseServiceEnv();
  return env.ok ? env.serviceRoleKey : null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

function payloadOf(session: DemoSession): string {
  return [session.adminUserId, String(session.expiresAt)].join(".");
}

/**
 * Constant-time compare that tolerates a length mismatch — `timingSafeEqual`
 * throws on differing lengths, and that throw would leak length.
 */
function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Throws when the key is missing — the caller is opening a session and must fail loudly. */
export function encodeDemoSession(
  adminUserId: string,
  now: number = Date.now()
): { value: string; session: DemoSession } {
  const key = signingKey();
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to open a demo session.");
  }
  const session: DemoSession = { adminUserId, expiresAt: now + DEMO_TTL_MS };
  const payload = payloadOf(session);
  return { value: `${payload}.${sign(payload, key)}`, session };
}

/** Null for anything unparseable, unsigned, mis-signed or expired. */
export function decodeDemoSession(
  value: string | undefined,
  now: number = Date.now()
): DemoSession | null {
  if (!value) return null;

  const key = signingKey();
  if (!key) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [adminUserId, expiresRaw, signature] = parts;

  const payload = [adminUserId, expiresRaw].join(".");
  if (!signatureMatches(sign(payload, key), signature)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  return { adminUserId, expiresAt };
}

export async function setDemoSessionCookie(adminUserId: string): Promise<DemoSession> {
  const { value, session } = encodeDemoSession(adminUserId);
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // A browser-session cookie on purpose: the signed `expiresAt` is the hard
    // limit, and closing the browser should end the demo without anyone having
    // to remember to.
  });
  return session;
}

/**
 * Drop the cookie. Called by "End demo session" and by `logoutAction`, so that
 * signing out of the demo School Head account also puts the deployment back to
 * hiding the training tenant — which is the behaviour the demo button promises.
 *
 * A no-op when there is no cookie, and that check is load-bearing: sign-out
 * paths can run inside Server Components, where the cookie store is read-only
 * and any write throws.
 */
export async function clearDemoSessionCookie(): Promise<void> {
  const store = await cookies();
  if (!store.has(COOKIE_NAME)) return;
  store.delete(COOKIE_NAME);
}

/**
 * The demo session on the current request, or null.
 *
 * Memoized per request with React `cache()` because a single render can consult
 * it several times — the login page's school list and the admin dashboard's
 * aggregates each ask independently.
 */
export const readDemoSession = cache(async (): Promise<DemoSession | null> => {
  const store = await cookies();
  return decodeDemoSession(store.get(COOKIE_NAME)?.value);
});

/**
 * Should this request see the demo tenant? The single question every demo
 * filter asks.
 *
 * Returns false whenever cookies cannot be read at all (a context with no
 * request store), because "cannot tell" must fail closed here: showing the demo
 * to a real school is the failure this module exists to prevent.
 */
export const isDemoVisible = cache(async (): Promise<boolean> => {
  try {
    return (await readDemoSession()) !== null;
  } catch {
    return false;
  }
});
