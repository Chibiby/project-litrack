import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { route } from "@/lib/errors/route";
import { AppError } from "@/lib/errors/app-error";
import { recordComplianceChanges } from "@/lib/compliance/record";

/**
 * The daily compliance check for the Full Compliance page: 00:05 Manila
 * (`5 16 * * *` UTC, see `worker.js` / `wrangler.jsonc`). Writes each school's
 * status and logs only the changes (`src/lib/compliance/record.ts`). A second
 * run the same day writes nothing. `src/middleware.ts` skips `/api/`, so this
 * route authorizes itself against CRON_SECRET, like the other cron routes.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route("GET /api/cron/compliance-record", async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    throw new AppError("AUTH_NOT_SIGNED_IN", { detail: "Missing or wrong CRON_SECRET" });
  }
  return NextResponse.json(await recordComplianceChanges());
});
