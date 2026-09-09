import { describe, expect, it } from "vitest";
import {
  parseMentionHandles,
  segmentMessage,
  type MentionTarget,
} from "@/lib/chat/mentions";

/**
 * Who a message notifies.
 *
 * The parse is the whole rule, and both directions of getting it wrong are
 * real: a missed handle means somebody asked for help and nobody was told, and
 * an over-eager one means a teacher's email address pings three division admins.
 *
 * Resolution to an account happens in the action, against the channel's own
 * members — this only decides which handles were typed.
 */

describe("parseMentionHandles", () => {
  it("finds a handle", () => {
    expect(parseMentionHandles("please check this @john")).toEqual(["john"]);
  });

  it("finds several, in the order typed, without repeats", () => {
    expect(parseMentionHandles("@brandan and @dante and @brandan again")).toEqual([
      "brandan",
      "dante",
    ]);
  });

  it("lowercases, so @John and @john are one person", () => {
    expect(parseMentionHandles("@John")).toEqual(["john"]);
  });

  it("reads a dotted teacher username whole", () => {
    // `teacher.cruz.1a2b` is the shape `teacherUsername` mints. Stopping at the
    // first dot would mention a "teacher" who does not exist.
    expect(parseMentionHandles("ask @teacher.cruz.1a2b about it")).toEqual([
      "teacher.cruz.1a2b",
    ]);
  });

  it("drops a trailing dot, because a sentence can end on a mention", () => {
    expect(parseMentionHandles("I will ask @john.")).toEqual(["john"]);
  });

  it("finds a handle at the very start and the very end", () => {
    expect(parseMentionHandles("@john can you look")).toEqual(["john"]);
    expect(parseMentionHandles("can you look @john")).toEqual(["john"]);
  });

  it("returns nothing when there is nothing to find", () => {
    expect(parseMentionHandles("no mentions here")).toEqual([]);
    expect(parseMentionHandles("")).toEqual([]);
    expect(parseMentionHandles("@")).toEqual([]);
  });
});

describe("segmentMessage", () => {
  const targets: MentionTarget[] = [
    { id: "u1", username: "john", displayName: "John Admin" },
    { id: "u2", username: "teacher.cruz.1a2b", displayName: "Maria Cruz" },
  ];

  it("renders a resolved handle as the person's name", () => {
    expect(segmentMessage("hi @john please look", targets)).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", text: "@John Admin", userId: "u1" },
      { kind: "text", text: " please look" },
    ]);
  });

  it("leaves an unresolved handle as plain text, not a dead chip", () => {
    // An email address is the case that matters: nobody typed a mention, and
    // turning half of it into a highlighted name would be nonsense.
    const segments = segmentMessage("mail me at cruz@deped.gov.ph", targets);
    expect(segments).toEqual([{ kind: "text", text: "mail me at cruz@deped.gov.ph" }]);
  });

  it("handles a message that is only a mention", () => {
    expect(segmentMessage("@john", targets)).toEqual([
      { kind: "mention", text: "@John Admin", userId: "u1" },
    ]);
  });

  it("keeps the rest of the message intact around several mentions", () => {
    const segments = segmentMessage("@john and @teacher.cruz.1a2b both", targets);
    expect(segments.map((s) => s.text).join("")).toBe(
      "@John Admin and @Maria Cruz both"
    );
    expect(segments.filter((s) => s.kind === "mention")).toHaveLength(2);
  });

  it("survives a target with no username rather than throwing", () => {
    const segments = segmentMessage("@john", [
      { id: "u3", username: null, displayName: "Nameless" },
    ]);
    expect(segments).toEqual([{ kind: "text", text: "@john" }]);
  });
});
