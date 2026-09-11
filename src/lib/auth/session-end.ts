/**
 * Why a person is looking at the login page.
 *
 * The reason travels as a short token in `?reason=`, never as a message: the
 * login page used to render `?error=<anything>` straight into a toast, which let
 * a crafted link put any sentence — a phone number to call, say — on the real
 * sign-in screen. Only these four tokens mean anything, and each maps to a
 * message from the catalog.
 *
 * Pure and dependency-free (a type-only import from the catalog) so
 * `src/middleware.ts` can use it on the edge runtime.
 */

import type { ErrorCode } from "@/lib/errors/codes";

export const SESSION_END_REASONS = {
  session_expired: "AUTH_SESSION_EXPIRED",
  account_disabled: "AUTH_ACCOUNT_DISABLED",
  declined: "AUTH_REGISTRATION_DECLINED",
  deactivated: "AUTH_ACCOUNT_DEACTIVATED",
} as const satisfies Record<string, ErrorCode>;

export type SessionEndReason = keyof typeof SESSION_END_REASONS;

export function sessionEndCode(value: unknown): ErrorCode | null {
  if (typeof value !== "string" || !Object.hasOwn(SESSION_END_REASONS, value)) return null;
  return SESSION_END_REASONS[value as SessionEndReason];
}

export function loginPath(area: "admin" | "school", reason?: SessionEndReason | null): string {
  const base = area === "admin" ? "/admin/login" : "/login";
  return reason ? `${base}?reason=${reason}` : base;
}

/** `sb-<project>-auth-token`, whole or chunked — not the PKCE verifier cookie. */
const SESSION_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

export function hasSupabaseSessionCookie(names: Iterable<string>): boolean {
  for (const name of names) if (SESSION_COOKIE.test(name)) return true;
  return false;
}
