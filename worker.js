/**
 * Cloudflare Worker entrypoint.
 *
 * OpenNext generates `.open-next/worker.js`, which handles every HTTP request.
 * This file wraps it so the Worker also answers Cron Triggers. The scheduled
 * backups used to come from the `crons` block in `vercel.json`; a Worker has no
 * equivalent, and Cron Triggers invoke `scheduled()` rather than fetching a URL,
 * so the schedule has to be mapped back onto the route by hand.
 *
 * Keep the cron expressions here identical to `triggers.crons` in
 * `wrangler.jsonc` — an expression with no entry in this map is a silent no-op.
 */
import worker from "./.open-next/worker.js";

// Durable Object classes and any other named bindings OpenNext generates.
export * from "./.open-next/worker.js";

/** Cron expression (UTC) → the route that does the work. */
const CRON_ROUTES = {
  // 00:00 Asia/Manila
  "0 16 * * *": "/api/cron/backup?kind=daily",
  // Sunday 00:30 Asia/Manila
  "30 16 * * 6": "/api/cron/backup?kind=weekly",
};

export default {
  ...worker,

  async scheduled(event, env, ctx) {
    const path = CRON_ROUTES[event.cron];
    if (!path) {
      console.error("[cron] no route mapped for expression", event.cron);
      return;
    }

    // The route authorizes itself against CRON_SECRET and fails closed when the
    // secret is unset, so an unconfigured Worker skips the run loudly here
    // rather than sending a request that can only come back 401.
    const secret = env.CRON_SECRET?.trim();
    if (!secret) {
      console.error("[cron] CRON_SECRET is not set; skipping", path);
      return;
    }

    const origin = env.NEXT_PUBLIC_APP_URL || "https://arallitrack.com";
    const request = new Request(new URL(path, origin), {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
    });

    const response = await worker.fetch(request, env, ctx);
    if (!response.ok) {
      console.error("[cron] run failed", path, response.status);
      return;
    }
    console.log("[cron] run ok", path);
  },
};
