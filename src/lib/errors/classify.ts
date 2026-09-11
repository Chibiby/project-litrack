/**
 * Anything thrown → AppError. Pure (no Prisma import: detection is by name and
 * code, as in `@/lib/db-errors`), so it runs in tests and on any server path.
 */

import { ZodError } from "zod";
import { isAuthError } from "@supabase/supabase-js";
import { classifyDbFailure } from "@/lib/db-errors";
import { AppError, type ErrorContext } from "./app-error";
import { validationError } from "./validation";
import { mapSupabaseAuthError } from "./supabase";

export type ClassifyOptions = {
  /** Completes "Couldn't {verb}" in database messages, e.g. "save the section". */
  verb?: string;
};

const PRISMA_ERROR_NAMES = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientRustPanicError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
]);

function prop(err: unknown, key: string): unknown {
  return err && typeof err === "object" ? (err as Record<string, unknown>)[key] : undefined;
}

function prismaName(err: unknown): string | null {
  const name = prop(err, "name");
  if (typeof name === "string" && PRISMA_ERROR_NAMES.has(name)) return name;
  const code = prop(err, "code");
  return typeof code === "string" && /^P\d{4}$/.test(code) ? "PrismaClientKnownRequestError" : null;
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "";
}

/** Admin detail: the whole message, bounded. Prisma's first line is often just "Invalid … invocation:". */
function detailOf(err: unknown): string {
  return rawMessage(err).replace(/\s+/g, " ").trim().slice(0, 2000);
}

export function classifyError(err: unknown, options: ClassifyOptions = {}): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return validationError(err);

  const params = options.verb ? { verb: options.verb } : {};
  const name = prismaName(err);
  if (name) {
    const code = prop(err, "code");
    const context: ErrorContext = { prismaError: name };
    if (typeof code === "string") context.prismaCode = code;
    const base = { cause: err, detail: detailOf(err), context };

    if (name === "PrismaClientValidationError") return new AppError("INTERNAL_ERROR", base);
    if (
      name === "PrismaClientInitializationError" &&
      /environment variable not found/i.test(rawMessage(err))
    ) {
      return new AppError("CONFIG_MISSING", base);
    }
    if (code === "P2025") return new AppError("NOT_FOUND", base);
    if (code === "P2002") return new AppError("DB_CONFLICT", base);

    const kind = classifyDbFailure(err);
    const appCode =
      kind === "SCHEMA_OUT_OF_DATE"
        ? "DB_SCHEMA_OUT_OF_DATE"
        : kind === "UNAVAILABLE"
          ? "DB_UNAVAILABLE"
          : "DB_ERROR";
    return new AppError(appCode, { ...base, params });
  }

  if (isAuthError(err)) {
    return new AppError(mapSupabaseAuthError(err, "server"), {
      cause: err,
      detail: detailOf(err),
      context: {
        supabaseCode: typeof err.code === "string" ? err.code : null,
        supabaseStatus: typeof err.status === "number" ? err.status : null,
      },
    });
  }

  return new AppError("INTERNAL_ERROR", { cause: err, detail: detailOf(err) });
}
