/**
 * The caller's address, as the platform reports it.
 *
 * Vercel sets `x-forwarded-for` with the client first. Falls back to
 * `x-real-ip`, then to a shared "unknown" bucket, which is deliberately strict:
 * a request whose origin cannot be told apart should share a limit with every
 * other such request, not escape it.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
