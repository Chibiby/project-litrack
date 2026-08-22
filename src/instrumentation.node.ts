import { registerOTel } from "@vercel/otel";

/**
 * Node-runtime OTel registration, run as a side effect via `register()`'s dynamic import.
 * `registerOTel` installs the OpenTelemetry SDK and `@vercel/otel`'s fetch auto-instrumentation
 * — that is the whole of it. There is no Prisma auto-instrumentation: Prisma 5 tracing is a
 * preview feature and stays off, `@prisma/instrumentation` is not installed, and
 * `src/lib/prisma.ts` is deliberately untouched. So the `litrack.auth.user_lookup` span in
 * `src/lib/auth/session.ts` is the only DB timing signal we have, and missing query spans
 * elsewhere are expected — not a broken exporter, plan tier, or deploy link.
 */
registerOTel({ serviceName: "litrack" });
