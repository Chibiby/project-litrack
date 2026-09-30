"use client";

import * as React from "react";
import { classifyClientFailure, isNextControlFlow } from "@/lib/errors/client";
import type { ErrorCode } from "@/lib/errors/codes";
import { isToasted, toastFailure } from "@/lib/ui/toast-failure";

/** Failures a person can act on. Anything else is a client bug, not their concern. */
const REPORTABLE: ReadonlySet<ErrorCode> = new Set([
  "NETWORK_OFFLINE",
  "SERVER_UNREACHABLE",
  "APP_UPDATED",
  "DB_UNAVAILABLE",
  "DB_SCHEMA_OUT_OF_DATE",
  "REQUEST_TOO_LARGE",
]);

function hasDigest(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    typeof (reason as { digest?: unknown }).digest === "string"
  );
}

/**
 * Safety net for a rejected server-action promise nobody handled. Call sites
 * should use `callAction`; this only makes sure a missed one is not silent.
 */
export function ClientErrorListener() {
  React.useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const { reason } = event;
      if (isNextControlFlow(reason) || isToasted(reason)) return;
      if (reason instanceof Error && reason.name === "AbortError") return;

      const failure = classifyClientFailure(reason);
      if (!REPORTABLE.has(failure.code) && !hasDigest(reason)) return;
      toastFailure(failure);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return null;
}
