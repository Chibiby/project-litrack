import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { canonicalAppUrl } from "@/lib/app-url";
import { prismaFresh } from "@/lib/prisma";
import { AppError } from "@/lib/errors/app-error";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import {
  AUTH_COOKIE_CACHE_VERSION,
  AUTH_COOKIE_PREFIX,
  authCookiesSecure,
} from "@/lib/auth/auth-cookies";

/**
 * The Better Auth server instance (spec section 2).
 *
 * There is deliberately no Better Auth catch-all route handler (invariant I6). Every
 * call is a server-side `auth.api.*` made from inside LITRACK's own wrapped
 * actions, so no Better Auth endpoint can bypass the school/approval gates,
 * the app rate limiter or the audit trail. `disableSignUp` closes the one
 * endpoint that would create accounts if a route were ever mounted.
 *
 * Reads always go through `prismaFresh`, never the cached Hyperdrive binding
 * (invariant I5): a session deleted by sign-out or `stopImpersonating` must
 * not come back from a 60-second query cache.
 */

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Session lifetime: 30 days, sliding. Any server-side session read older than
 * `updateAgeSeconds` pushes `expiresAt` another 30 days out (only where
 * cookies can be written — `nextCookies` skips the refresh on plain RSC
 * renders, see risk R5).
 */
export const AUTH_SESSION_LIFETIME = {
  expiresInSeconds: 30 * DAY_SECONDS,
  updateAgeSeconds: DAY_SECONDS,
} as const;

/** Return-to-admin window for "Sign in as" (2 hours, the old ticket TTL). */
export const IMPERSONATION_SESSION_SECONDS = 2 * 60 * 60;

/** Better Auth refuses shorter secrets in spirit (it warns); we refuse in fact. */
const MIN_SECRET_LENGTH = 32;

function readSecret(): string | null {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/** Whether sign-in can work at all on this deployment. Never throws. */
export function isAuthConfigured(): boolean {
  return readSecret() !== null;
}

function createAuth(secret: string) {
  return betterAuth({
    appName: "LITRACK",
    secret,
    baseURL: canonicalAppUrl(),
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    database: prismaAdapter(prismaFresh, { provider: "postgresql" }),
    user: { modelName: "authUser" },
    session: {
      modelName: "authSession",
      expiresIn: AUTH_SESSION_LIFETIME.expiresInSeconds,
      updateAge: AUTH_SESSION_LIFETIME.updateAgeSeconds,
      cookieCache: {
        enabled: true,
        maxAge: 300,
        strategy: "compact",
        version: AUTH_COOKIE_CACHE_VERSION,
      },
    },
    account: {
      modelName: "authAccount",
      accountLinking: { enabled: false },
    },
    verification: { modelName: "authVerification" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: authCookiesSecure(),
      database: {
        // A function, not the "uuid" shorthand: with the Prisma adapter on
        // postgresql, "uuid" makes Better Auth omit `id` and rely on a
        // database default (`supportsUUIDs: true` in @better-auth/prisma-adapter,
        // `get-id-field.mjs` in @better-auth/core). The Auth* tables have no
        // default on `id`, so every session insert would fail. Same ids either way.
        generateId: () => crypto.randomUUID(),
      },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    },
    plugins: [
      admin({
        adminRoles: ["SUPER_ADMIN"],
        defaultRole: "TEACHER",
        // Required: `hasPermission` only knows `admin` / `user` by default, so
        // without this map SUPER_ADMIN would be refused `impersonate`. `adminAc`
        // has no `impersonate-admins`, so a Super Admin can never be impersonated.
        roles: {
          SUPER_ADMIN: adminAc,
          SCHOOL_HEAD: userAc,
          TEACHER: userAc,
          DISTRICT_ADMIN: userAc,
        },
        allowImpersonatingAdmins: false,
        impersonationSessionDuration: IMPERSONATION_SESSION_SECONDS,
      }),
      // Must stay last: it copies every Set-Cookie the endpoints above wrote
      // onto Next's cookie store, which is how server actions sign people in.
      nextCookies(),
    ],
  });
}

export type LitrackAuth = ReturnType<typeof createAuth>;

let instance: LitrackAuth | null = null;

/**
 * The instance, built on first call and never at import (the same reason as
 * `@/lib/prisma`: env and Cloudflare bindings are only readable inside a
 * request). `prismaFresh` is a lazy proxy, so one instance safely serves every
 * request — each query resolves the current request's client.
 *
 * Throws `CONFIG_MISSING` (variable name only) when the secret is absent.
 */
export function getAuth(): LitrackAuth {
  if (instance) return instance;
  const secret = readSecret();
  if (!secret) {
    throw new AppError("CONFIG_MISSING", {
      detail: `Missing or invalid environment variables: BETTER_AUTH_SECRET (at least ${MIN_SECRET_LENGTH} characters)`,
      context: { reason: "auth_secret_missing" },
    });
  }
  instance = createAuth(secret);
  return instance;
}
