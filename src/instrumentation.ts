import type { Instrumentation } from "next";

export async function register() {
  // Node-runtime only. `register()` runs in every runtime, and an unguarded call
  // compiles the whole OTel SDK into the edge middleware bundle (+58 kB gzipped) and
  // boots it before the first cookie refresh on every fresh edge isolate. Middleware
  // has no hand-rolled spans and no Prisma, so it gains nothing from that. The
  // per-compilation NEXT_RUNTIME define folds this branch away in the edge build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}

/**
 * Every uncaught server error, sent to the same place a failed action goes.
 *
 * Guarded and dynamically imported for the same reason `register()` is: the
 * reporting stack reaches Prisma, and the NEXT_RUNTIME define folds this branch
 * away in the edge build so middleware never pays for it.
 */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("./lib/errors/request-error");
  await reportRequestError(...args);
};
