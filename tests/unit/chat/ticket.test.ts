import { describe, expect, it } from "vitest";
import {
  TICKET_TTL_MS,
  resolveTicketSecret,
  signTicket,
  verifyTicket,
} from "@/lib/chat/live/ticket";

const SECRET = "test-secret-at-least-somewhat-long";
const CLAIMS = { c: "chan-1", u: "user-1", n: "Ana Cruz", i: "AC", r: "MEMBER" as const };
const NOW = 1_800_000_000_000;

function flip(s: string, index: number): string {
  const ch = s[index];
  const next = ch === "A" ? "B" : "A";
  return s.slice(0, index) + next + s.slice(index + 1);
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("socket tickets", () => {
  it("round-trips claims", async () => {
    const ticket = await signTicket(CLAIMS, SECRET, NOW);
    expect(await verifyTicket(ticket, SECRET, NOW + 1000)).toEqual({ ...CLAIMS, exp: NOW + TICKET_TTL_MS });
  });

  it("rejects after 60 s", async () => {
    expect(TICKET_TTL_MS).toBe(60_000);
    const ticket = await signTicket(CLAIMS, SECRET, NOW);
    expect(await verifyTicket(ticket, SECRET, NOW + 60_001)).toBeNull();
  });

  it("rejects a flipped signature byte", async () => {
    const ticket = await signTicket(CLAIMS, SECRET, NOW);
    const dot = ticket.indexOf(".");
    expect(await verifyTicket(flip(ticket, dot + 3), SECRET, NOW)).toBeNull();
  });

  it("rejects a payload edited to another channel", async () => {
    const ticket = await signTicket(CLAIMS, SECRET, NOW);
    const signature = ticket.split(".")[1];
    const forged = `${b64urlJson({ ...CLAIMS, c: "chan-2", exp: NOW + TICKET_TTL_MS })}.${signature}`;
    expect(await verifyTicket(forged, SECRET, NOW)).toBeNull();
  });

  it("rejects a different secret", async () => {
    const ticket = await signTicket(CLAIMS, SECRET, NOW);
    expect(await verifyTicket(ticket, "another-secret", NOW)).toBeNull();
  });

  it("rejects garbage", async () => {
    for (const bad of ["", "abc", "a.b.c", "....", `${b64urlJson({ c: 1 })}.xx`]) {
      expect(await verifyTicket(bad, SECRET, NOW)).toBeNull();
    }
  });

  it("secret falls back to BETTER_AUTH_SECRET, null when both unset or blank", () => {
    expect(resolveTicketSecret({ CHAT_SOCKET_SECRET: "a", BETTER_AUTH_SECRET: "b" })).toBe("a");
    expect(resolveTicketSecret({ CHAT_SOCKET_SECRET: "  ", BETTER_AUTH_SECRET: "b" })).toBe("b");
    expect(resolveTicketSecret({})).toBeNull();
    expect(resolveTicketSecret({ BETTER_AUTH_SECRET: " " })).toBeNull();
  });
});
