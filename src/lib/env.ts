import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";

/**
 * Server-side environment validation.
 * Never log resolved values — only variable names on failure.
 *
 */

const DEFAULT_SYNTHETIC_EMAIL_DOMAIN = "litrack.local";

/**
 * A lite model, and pinned rather than tracking `gemini-flash-latest`: the
 * assistant is grounded by a prompt whose behaviour was checked against one
 * model, and a silent upgrade underneath it would change answers nobody
 * re-read. Gemini 2.5 Flash is not an option: Google refuses it to new keys.
 */
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  // Optional. Seals the School Head passwords the Super Admin console reveals;
  // `@/lib/auth/password-vault` stores nothing at all when no key exists. Read
  // directly from `process.env` there rather than through this parse, because
  // the vault is also exercised by unit tests that swap keys between cases.
  PASSWORD_VAULT_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  SYNTHETIC_EMAIL_DOMAIN: z.string().min(1).optional().default(DEFAULT_SYNTHETIC_EMAIL_DOMAIN),
  // Optional on purpose. With no key the assistant answers from its curated
  // index exactly as it did before Gemini existed, so a missing or spent
  // credential degrades the answer rather than breaking the panel — and CI
  // builds with placeholder env without needing a real one.
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).optional().default(DEFAULT_GEMINI_MODEL),
  // Signs Better Auth's session cookies. `@/lib/auth/better-auth`
  // reads it directly and refuses to start sign-in when it is shorter than 32
  // characters, so a missing value fails sign-in, not every page.
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  // Public base URL of the R2 avatar bucket (custom domain). Inlined at build
  // time, so it must be set in the build env as well as the runtime vars.
  NEXT_PUBLIC_AVATAR_BASE_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

function readEnvInput(): Record<string, string | undefined> {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL || undefined,
    PASSWORD_VAULT_KEY: process.env.PASSWORD_VAULT_KEY || undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || undefined,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
    SYNTHETIC_EMAIL_DOMAIN: process.env.SYNTHETIC_EMAIL_DOMAIN || undefined,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
    GEMINI_MODEL: process.env.GEMINI_MODEL || undefined,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || undefined,
    NEXT_PUBLIC_AVATAR_BASE_URL: process.env.NEXT_PUBLIC_AVATAR_BASE_URL || undefined,
  };
}

function missingVarNames(issues: z.ZodIssue[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string") names.add(key);
  }
  return [...names].sort();
}

/**
 * Parse and cache server env once. Throws with missing variable NAMES only.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(readEnvInput());
  if (!parsed.success) {
    const missing = missingVarNames(parsed.error.issues);
    // Names only, never values — and now carrying a code the handler can
    // classify, so a misconfigured server tells the person "not set up yet"
    // while the variable names go only to the admin record.
    throw new AppError("CONFIG_MISSING", {
      detail: `Missing or invalid environment variables: ${missing.join(", ")}`,
      context: { reason: "env_missing" },
    });
  }

  cached = parsed.data;
  return cached;
}
