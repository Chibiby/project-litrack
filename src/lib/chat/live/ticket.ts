/**
 * Short-lived, single-channel tickets for joining a live chat room.
 *
 * `openChatSocket` (a server action, after `assertChannelAccess`) signs one;
 * `worker.js` verifies it before the WebSocket upgrade reaches the room. The
 * ticket is the only thing that lets a socket into a room, so it carries the
 * identity the room relabels typing with — a client can never speak as
 * someone else.
 *
 * Imported by worker.js, which wrangler bundles without the `@/` alias: keep
 * this file free of path-alias imports. Web Crypto only, so it runs the same
 * in Node (tests, server actions) and in workerd.
 */

export type TicketClaims = {
  /** Channel id. */
  c: string;
  /** User id. */
  u: string;
  /** Display name. */
  n: string;
  /** Initials. */
  i: string;
  /** Super Admin or not — the room hides admins from members. */
  r: "SUPER_ADMIN" | "MEMBER";
  /** Expiry, epoch ms. */
  exp: number;
};

export const TICKET_TTL_MS = 60_000;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signTicket(
  claims: Omit<TicketClaims, "exp">,
  secret: string,
  now: number = Date.now()
): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ ...claims, exp: now + TICKET_TTL_MS })));
  const key = await hmacKey(secret, "sign");
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

function isClaims(value: unknown): value is TicketClaims {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.c === "string" &&
    typeof v.u === "string" &&
    typeof v.n === "string" &&
    typeof v.i === "string" &&
    (v.r === "SUPER_ADMIN" || v.r === "MEMBER") &&
    typeof v.exp === "number"
  );
}

/** The claims, or null when the ticket is malformed, forged or expired. */
export async function verifyTicket(
  ticket: string,
  secret: string,
  now: number = Date.now()
): Promise<TicketClaims | null> {
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [payload, signatureText] = parts;
  const signature = fromBase64Url(signatureText);
  const payloadBytes = fromBase64Url(payload);
  if (!signature || !payloadBytes) return null;

  const key = await hmacKey(secret, "verify");
  // `verify` compares in constant time; never compare signatures as strings.
  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(payload));
  if (!valid) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  if (now > claims.exp) return null;
  return { c: claims.c, u: claims.u, n: claims.n, i: claims.i, r: claims.r, exp: claims.exp };
}

/** `CHAT_SOCKET_SECRET`, else `BETTER_AUTH_SECRET`; null when neither is set. */
export function resolveTicketSecret(env: { CHAT_SOCKET_SECRET?: string; BETTER_AUTH_SECRET?: string }): string | null {
  const own = env.CHAT_SOCKET_SECRET?.trim();
  if (own) return own;
  const auth = env.BETTER_AUTH_SECRET?.trim();
  return auth || null;
}
