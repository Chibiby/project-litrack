import {
  readBoundImpersonationSession,
  type ImpersonationContext,
} from "@/lib/auth/impersonation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";

/**
 * Single source of truth for "is the current request an admin impersonating
 * someone else". Every entry point an impersonated session can land on
 * mounts this immediately above `{children}` so the banner — and the way
 * back to the admin's own session — can never be suppressed or forgotten on
 * a new route.
 *
 * `userId` must be the id of the user already loaded for this request (never
 * re-derived from role: a Super Admin browsing `/teacher` directly also has
 * `role === "TEACHER"` semantics on some pages, so only an exact id match
 * against the ticket's `targetUserId` tells impersonation apart from a real
 * session).
 */
export async function ImpersonationNotice({
  userId,
  accountName,
  impersonation,
}: {
  userId: string;
  accountName: string;
  /**
   * A bound result already read by the enclosing layout. Supplying it keeps
   * every layout decision and this notice tied to the same live session check.
   */
  impersonation?: ImpersonationContext | null;
}) {
  const context =
    impersonation === undefined
      ? await readBoundImpersonationSession((await createSupabaseServerClient()).auth)
      : impersonation;
  if (context?.ticket.targetUserId !== userId) return null;

  return <ImpersonationBanner accountName={accountName} expired={context.expired} />;
}
