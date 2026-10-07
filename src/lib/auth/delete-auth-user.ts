import "server-only";
import { deleteIdentity } from "@/lib/auth/identity";

/**
 * Remove a sign-in identity so the email can be reused (e.g. allow re-register).
 * Sessions and the credential account cascade. A missing identity counts as ok.
 */
export async function deleteAuthUser(
  authId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteIdentity(authId);
    return { ok: true };
  } catch (err) {
    console.error("[deleteAuthUser] failed:", err);
    return {
      ok: false,
      error: "Failed to remove auth account. Please try again or contact support.",
    };
  }
}
