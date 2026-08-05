/**
 * Public base URL for invite links and absolute redirects.
 * Prefer NEXT_PUBLIC_APP_URL; on Vercel fall back to https://VERCEL_URL.
 * Never emit localhost links when NODE_ENV/VERCEL indicates production.
 */
export function getAppBaseUrl(): { ok: true; url: string } | { ok: false; error: string } {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (explicit) {
    return { ok: true, url: explicit };
  }

  const vercel = process.env.VERCEL_URL?.trim().replace(/\/$/, "");
  if (vercel) {
    const host = vercel.startsWith("http") ? vercel : `https://${vercel}`;
    return { ok: true, url: host.replace(/\/$/, "") };
  }

  const isProd =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  if (isProd) {
    return {
      ok: false,
      error:
        "NEXT_PUBLIC_APP_URL (or VERCEL_URL) must be set in production to build invite links",
    };
  }

  return { ok: true, url: "http://localhost:3000" };
}
