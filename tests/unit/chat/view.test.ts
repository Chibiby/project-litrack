import { describe, expect, it } from "vitest";
import {
  EDIT_WINDOW_MS,
  GROUP_WINDOW_MS,
  REACTION_EMOJI,
  REACTION_LABELS,
  canEditMessage,
  groupMessages,
  previewLine,
  seenLabel,
  typingLabel,
} from "@/lib/chat/view";

const at = (h: number, m: number, day = 10) => new Date(2026, 10, day, h, m, 0);

describe("constants", () => {
  it("has the six reactions in order, each labelled", () => {
    expect(REACTION_EMOJI).toEqual(["👍", "❤️", "😂", "😮", "😢", "🙏"]);
    expect(REACTION_LABELS["👍"]).toBe("thumbs up");
    expect(REACTION_LABELS["🙏"]).toBe("thank you");
    expect(GROUP_WINDOW_MS).toBe(300_000);
    expect(EDIT_WINDOW_MS).toBe(900_000);
  });
});

describe("groupMessages", () => {
  it("groups a burst within 5 minutes", () => {
    const groups = groupMessages([
      { id: "1", authorId: "a", createdAt: at(9, 0) },
      { id: "2", authorId: "a", createdAt: at(9, 3) },
      { id: "3", authorId: "a", createdAt: at(9, 5) },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(groups[0].authorId).toBe("a");
    expect(groups[0].dayKey).toBe("2026-11-10");
  });

  it("splits at a 6-minute gap", () => {
    const groups = groupMessages([
      { id: "1", authorId: "a", createdAt: at(9, 0) },
      { id: "2", authorId: "a", createdAt: at(9, 6) },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("splits on author change and on day change", () => {
    const groups = groupMessages([
      { id: "1", authorId: "a", createdAt: at(23, 58, 10) },
      { id: "2", authorId: "b", createdAt: at(23, 59, 10) },
      { id: "3", authorId: "b", createdAt: at(0, 1, 11) },
    ]);
    expect(groups.map((g) => g.items.map((m) => m.id))).toEqual([["1"], ["2"], ["3"]]);
    expect(groups[2].dayKey).toBe("2026-11-11");
  });
});

describe("canEditMessage", () => {
  const sent = at(9, 0);
  const own = { authorId: "me", createdAt: sent, deletedAt: null };

  it("allows edit at 14:59 and refuses at 15:01", () => {
    expect(canEditMessage(own, "me", new Date(sent.getTime() + 14 * 60_000 + 59_000))).toBe(true);
    expect(canEditMessage(own, "me", new Date(sent.getTime() + 15 * 60_000 + 1_000))).toBe(false);
  });

  it("refuses edit of another author or a deleted message", () => {
    const now = new Date(sent.getTime() + 60_000);
    expect(canEditMessage(own, "someone-else", now)).toBe(false);
    expect(canEditMessage({ ...own, deletedAt: now }, "me", now)).toBe(false);
  });
});

describe("typingLabel", () => {
  it("covers nobody, one, two and many", () => {
    expect(typingLabel([])).toBeNull();
    expect(typingLabel(["Ana"])).toBe("Ana is typing…");
    expect(typingLabel(["Ana", "Ben"])).toBe("Ana and Ben are typing…");
    expect(typingLabel(["Ana", "Ben", "Cy"])).toBe("3 people are typing…");
  });
});

describe("seenLabel", () => {
  const r = (name: string, m = 0) => ({ name, readAt: at(14, m) });

  it("names readers in the staff room, with +N past two", () => {
    expect(seenLabel("SCHOOL", [])).toBeNull();
    expect(seenLabel("SCHOOL", [r("Ana")])).toBe("Seen by Ana");
    expect(seenLabel("SCHOOL", [r("Ana"), r("Ben")])).toBe("Seen by Ana, Ben");
    expect(seenLabel("SCHOOL", [r("Ana"), r("Ben"), r("Cy"), r("Di")])).toBe("Seen by Ana, Ben +2");
  });

  it("gives the latest read time on the admin line", () => {
    const label = seenLabel("ADMIN_DIRECT", [r("Admin", 10), r("Admin 2", 14)]);
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at(14, 14));
    expect(label).toBe(`Seen ${time}`);
    expect(seenLabel("ADMIN_DIRECT", [])).toBeNull();
  });
});

describe("previewLine", () => {
  const base = { body: "Hello there", deletedAt: null, authorId: "a", authorFirstName: "Ana" };

  it("prefixes You: for own message and the name for others", () => {
    expect(previewLine(base, "a")).toBe("You: Hello there");
    expect(previewLine(base, "b")).toBe("Ana: Hello there");
  });

  it("says Message removed for a deleted message", () => {
    expect(previewLine({ ...base, body: "", deletedAt: new Date() }, "b")).toBe("Message removed");
  });

  it("keeps the first line and cuts long text at 80 characters", () => {
    expect(previewLine({ ...base, body: "line one\nline two" }, "b")).toBe("Ana: line one");
    const long = "x".repeat(100);
    const out = previewLine({ ...base, body: long }, "b");
    expect(out).toBe(`Ana: ${"x".repeat(80)}…`);
  });
});
