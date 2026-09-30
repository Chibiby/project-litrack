/**
 * Anything thrown → AppError. Pure (no Prisma import: detection is by name,
 * code and the query provenance mark, as in `@/lib/db-errors`), so it runs in
 * tests and on any server path.
 */

import { ZodError } from "zod";
import { isAuthError } from "@supabase/supabase-js";
import { classifyDbFailure, dbFailureCode, isDatabaseError } from "@/lib/db-errors";
import type { ErrorParams } from "./codes";
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

/**
 * Prisma errors by name, plus what Prisma lets through unwrapped: a raw
 * `DriverAdapterError` (any SQLSTATE without a dedicated adapter kind), a pg
 * server error, or a plain Error thrown from a query and marked by
 * `markDbError`. A marked error with the generic name "Error" (or pg's
 * lowercase "error") is labelled "DatabaseError" for admins.
 */
function databaseErrorName(err: unknown): string | null {
  const prisma = prismaName(err);
  if (prisma) return prisma;
  if (!isDatabaseError(err)) return null;
  const name = prop(err, "name");
  return typeof name === "string" && name.toLowerCase() !== "error" ? name : "DatabaseError";
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

  const params: ErrorParams = options.verb ? { verb: options.verb } : {};
  const name = databaseErrorName(err);
  if (name) {
    const code = prop(err, "code");
    const context: ErrorContext = { prismaError: name };
    const failureCode = dbFailureCode(err);
    if (failureCode) context.prismaCode = failureCode;
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
    // Bad credentials or a missing database: retrying can't help and the
    // person can't fix it, so it reads as server configuration, not an outage.
    if (kind === "CONFIG") return new AppError("CONFIG_MISSING", base);
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
