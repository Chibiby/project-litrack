import type { Instrumentation } from "next";

/**
 * `LITRACK_DEPLOY_TARGET` is injected by next.config.mjs and is therefore a
 * compile-time constant in the production server bundle. OpenNext presents the
 * app as Next.js' `nodejs` runtime, so NEXT_RUNTIME alone cannot distinguish a
 * Cloudflare Worker from a real Node/Vercel process.
 */
function shouldUseVercelNodeObservability() {
  return (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.LITRACK_DEPLOY_TARGET !== "cloudflare"
  );
}

export async function register() {
  // @vercel/otel is Vercel/Node-specific. Keeping the condition compile-time
  // visible lets the Cloudflare production build remove this import path.
  if (shouldUseVercelNodeObservability()) {
    await import("./instrumentation.node");
  }
}

/**
 * Every uncaught server error on Vercel/local Node is sent to the application's
 * database-backed reporting pipeline. On Cloudflare, keep the error in Workers
 * Logs instead of importing Vercel/Prisma observability while handling a crash.
 */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.LITRACK_DEPLOY_TARGET === "cloudflare") {
    console.error("[request-error]", args[0]);
    return;
  }

  const { reportRequestError } = await import("./lib/errors/request-error");
  await reportRequestError(...args);
};
