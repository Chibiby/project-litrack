import type { Instrumentation } from "next";

/**
 * OpenNext runs the application using Next.js' `nodejs` runtime semantics even
 * though the deployed process is Cloudflare workerd. Do not use NEXT_RUNTIME
 * alone to decide whether Vercel-specific Node instrumentation is safe.
 *
 * Vercel sets VERCEL=1 for its deployments. We also keep the instrumentation
 * available in local development where it is useful for diagnostics.
 */
function shouldUseVercelNodeObservability() {
  return (
    process.env.NEXT_RUNTIME === "nodejs" &&
    (process.env.VERCEL === "1" || process.env.NODE_ENV === "development")
  );
}

export async function register() {
  // @vercel/otel is designed for the Vercel/Node runtime. Loading it in an
  // OpenNext Worker can leave Node built-ins as runtime externals and prevent
  // the server from starting. Keep it out of the Cloudflare production bundle.
  if (shouldUseVercelNodeObservability()) {
    await import("./instrumentation.node");
  }
}

/**
 * Every uncaught server error on Vercel/local Node is sent to the application's
 * database-backed reporting pipeline. On Cloudflare, keep the error visible in
 * Workers Logs instead of importing that Vercel/Prisma reporting stack while
 * the Worker itself is handling an exception.
 */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!shouldUseVercelNodeObservability()) {
    console.error("[request-error]", args[0]);
    return;
  }

  const { reportRequestError } = await import("./lib/errors/request-error");
  await reportRequestError(...args);
};
