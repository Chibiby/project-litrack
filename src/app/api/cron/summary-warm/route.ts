import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { route } from "@/lib/errors/route";
import { AppError } from "@/lib/errors/app-error";
import { warmOnce } from "@/lib/summary/warm";

/**
 * Scheduled pre-load of the Division Summary's division raw entries (one per
 * facet, default period), which every scope and level shapes from. The Worker fires
 * it every 5 minutes (see `worker.js` / `wrangler.jsonc`), but the warm itself
 * is cached (`warmOnce`): it runs after a deploy or a summary reset, and at
 * most once a day otherwise. `src/middleware.ts` skips `/api/`, so this route
 * authorizes itself against CRON_SECRET, like the backup cron.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route("GET /api/cron/summary-warm", async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    throw new AppError("AUTH_NOT_SIGNED_IN", { detail: "Missing or wrong CRON_SECRET" });
  }

  const outcome = await warmOnce();
  // A failed load must not look like success to the Worker (it only checks
  // response.ok); keep the stored outcome in the body.
  return NextResponse.json(outcome, { status: outcome.failures.length > 0 ? 502 : 200 });
});

