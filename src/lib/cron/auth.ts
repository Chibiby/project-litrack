import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared check for cron routes: the Worker's scheduled() handler sends
 * `Authorization: Bearer $CRON_SECRET`. Fails closed when the secret is unset.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  // Fail closed. An unset secret must not mean "allow everyone" - that is the
  // difference between a misconfiguration and an open endpoint.
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  // Constant-time compare. SHA-256 both sides first so the two buffers
  // handed to timingSafeEqual are always 32 bytes each - that sidesteps the
  // length check `timingSafeEqual` would otherwise need (and the throw on
  // mismatched lengths that check exists to avoid).
  const expectedDigest = createHash("sha256").update(`Bearer ${secret}`).digest();
  const receivedDigest = createHash("sha256").update(header).digest();
  return timingSafeEqual(expectedDigest, receivedDigest);
}
