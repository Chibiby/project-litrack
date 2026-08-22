import { registerOTel } from "@vercel/otel";

/**
 * Next.js calls this once per server runtime on boot. `registerOTel` installs the
 * OpenTelemetry SDK plus Vercel's auto-instrumentation (fetch, Prisma), which is
 * where query spans come from — `src/lib/prisma.ts` is deliberately untouched.
 */
export function register() {
  registerOTel({ serviceName: "litrack" });
}
