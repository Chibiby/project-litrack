import { NextResponse } from "next/server";
import { listAdminConversations } from "@/lib/actions/chat";
import { requireUser } from "@/lib/auth/session";
import { route } from "@/lib/errors/route";

/**
 * The Support hub's 10 s poll of the conversation list (Super Admin only).
 *
 * A GET Route Handler rather than a server action for the reason given in
 * `../channel/route.ts`: an action poll re-rendered the whole Support page every
 * 10 s and held the admin's own sends behind it.
 */

export const dynamic = "force-dynamic";

export const GET = route("GET /api/chat/admin-conversations", async () => {
  await requireUser(["SUPER_ADMIN"]);
  const result = await listAdminConversations();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
});
