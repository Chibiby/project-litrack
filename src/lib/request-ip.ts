/**
 * The caller's address, as the platform reports it.
 *
 * On the Cloudflare Workers deploy (`LITRACK_DEPLOY_TARGET === "cloudflare"`,
 * inlined at build time), `cf-connecting-ip` is set by the edge and cannot be
 * overridden by the client, so it wins — a client CAN supply the first
 * `x-forwarded-for` entry there. On every other target nothing strips
 * `cf-connecting-ip`, so a client could send a fresh one per request and dodge
 * every per-address limit; it is ignored there.
 *
 * Otherwise: the first `x-forwarded-for` entry (Vercel and local proxies put
 * the client first), then `x-real-ip`, then a shared "unknown" bucket, which is
 * deliberately strict: a request whose origin cannot be told apart should share
 * a limit with every other such request, not escape it.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  if (process.env.LITRACK_DEPLOY_TARGET === "cloudflare") {
    const cloudflare = headers.get("cf-connecting-ip")?.trim();
    if (cloudflare) return cloudflare;
  }
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
