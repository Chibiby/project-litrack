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
