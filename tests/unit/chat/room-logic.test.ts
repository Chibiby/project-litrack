import { describe, expect, it } from "vitest";
import {
  ROOM_SOCKET_MAX_AGE_MS,
  TYPING_EXPIRE_MS,
  parseClientFrame,
  presenceFor,
  typingFor,
  type SocketIdentity,
} from "@/lib/chat/live/room-logic";

const who = (userId: string, isAdmin = false, displayName = userId): SocketIdentity => ({
  userId,
  displayName,
  initials: displayName.slice(0, 2).toUpperCase(),
  isAdmin,
  joinedAt: 0,
});

const teacher = who("t1", false, "Ana");
const head = who("h1", false, "Ben");
const admin = who("a1", true, "Admin");

describe("room constants", () => {
  it("closes sockets after 10 minutes and expires typing after 6 s", () => {
    expect(ROOM_SOCKET_MAX_AGE_MS).toBe(600_000);
    expect(TYPING_EXPIRE_MS).toBe(6_000);
  });
});

describe("presenceFor", () => {
  it("filters super admin from non-admin viewers", () => {
    expect(presenceFor(teacher, [teacher, head, admin])).toEqual(["h1"]);
  });

  it("admins see everyone", () => {
    expect(presenceFor(admin, [teacher, head, admin]).sort()).toEqual(["h1", "t1"]);
  });

  it("viewer never sees self", () => {
    expect(presenceFor(head, [head])).toEqual([]);
  });

  it("dedupes two tabs of one user", () => {
    expect(presenceFor(teacher, [head, head, teacher])).toEqual(["h1"]);
  });
});

describe("typingFor", () => {
  it("filters super admin from non-admin viewers", () => {
    expect(typingFor(teacher, [admin, head])).toEqual({ userIds: ["h1"], names: ["Ben"] });
  });

  it("admins see member typing and never themselves", () => {
    expect(typingFor(admin, [admin, teacher, teacher])).toEqual({ userIds: ["t1"], names: ["Ana"] });
  });
});

describe("parseClientFrame", () => {
  it("reads typing and ping frames", () => {
    expect(parseClientFrame('{"type":"typing","on":true}')).toEqual({ type: "typing", on: true });
    expect(parseClientFrame('{"type":"typing","on":false}')).toEqual({ type: "typing", on: false });
    expect(parseClientFrame('{"type":"ping"}')).toEqual({ type: "ping" });
  });

  it("ignores unknown types and bad JSON", () => {
    expect(parseClientFrame("not json")).toBeNull();
    expect(parseClientFrame('{"type":"message.created"}')).toBeNull();
    expect(parseClientFrame('{"type":"typing","on":"yes"}')).toBeNull();
    expect(parseClientFrame("null")).toBeNull();
    expect(parseClientFrame("x".repeat(5000))).toBeNull();
  });
});
