import type { Prisma } from "@prisma/client";

/** Filters for `/admin/errors`, kept out of the page so they can be tested. */

export const ERROR_LOG_WINDOWS = { "24h": 1, "7d": 7, "30d": 30 } as const;
export type ErrorLogWindow = keyof typeof ERROR_LOG_WINDOWS;

export type ErrorLogParams = {
  ref: string | null;
  code: string | null;
  severity: "security" | "system" | null;
  schoolId: string | null;
  window: ErrorLogWindow;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseErrorLogParams(
  searchParams: Record<string, string | string[] | undefined>
): ErrorLogParams {
  const windowParam = str(searchParams.window);
  const severity = str(searchParams.severity);
  return {
    ref: str(searchParams.ref),
    code: str(searchParams.code),
    severity: severity === "security" || severity === "system" ? severity : null,
    schoolId: str(searchParams.schoolId),
    window:
      windowParam && Object.hasOwn(ERROR_LOG_WINDOWS, windowParam)
        ? (windowParam as ErrorLogWindow)
        : "24h",
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildErrorLogQuery(
  params: ErrorLogParams,
  now: Date = new Date()
): Prisma.ErrorEventWhereInput {
  // A reference is a direct lookup: someone read it off a screen, and the time
  // window is exactly the thing they do not know.
  if (params.ref) return { ref: params.ref };

  const where: Prisma.ErrorEventWhereInput = {
    createdAt: { gte: new Date(now.getTime() - ERROR_LOG_WINDOWS[params.window] * DAY_MS) },
  };
  if (params.code) where.code = params.code;
  if (params.severity) where.severity = params.severity;
  if (params.schoolId) where.schoolId = params.schoolId;
  return where;
}
