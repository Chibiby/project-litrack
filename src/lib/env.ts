import "server-only";
import { z } from "zod";

/**
 * Server-side environment validation.
 * Never log resolved values — only variable names on failure.
 *
 * Middleware and Supabase helpers in `src/lib/supabase/env.ts` remain
 * soft-fail so the edge layer keeps working when public env is missing.
 */

const DEFAULT_SYNTHETIC_EMAIL_DOMAIN = "litrack.local";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  SYNTHETIC_EMAIL_DOMAIN: z.string().min(1).optional().default(DEFAULT_SYNTHETIC_EMAIL_DOMAIN),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;
let warnedMissingServiceRole = false;

function readEnvInput(): Record<string, string | undefined> {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL || undefined,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || undefined,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
    SYNTHETIC_EMAIL_DOMAIN: process.env.SYNTHETIC_EMAIL_DOMAIN || undefined,
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
    throw new Error(
      `Missing or invalid environment variables: ${missing.join(", ")}`
    );
  }

  if (!parsed.data.SUPABASE_SERVICE_ROLE_KEY && !warnedMissingServiceRole) {
    warnedMissingServiceRole = true;
    console.warn(
      "[env] SUPABASE_SERVICE_ROLE_KEY is not set — admin Auth APIs will fail until it is configured."
    );
  }

  cached = parsed.data;
  return cached;
}
