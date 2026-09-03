import { describe, expect, it } from "vitest";
import {
  MIN_SCORE,
  answerQuery,
  findTopic,
  suggestTopics,
  tokenize,
} from "@/lib/help/search";
import { HELP_TOPICS } from "@/lib/help/topics";

/**
 * The assistant's whole answering mechanism.
 *
 * There is no model behind this panel, so `answerQuery` IS the product. Two of
 * its properties matter more than any individual ranking:
 *
 * 1. **It returns nothing rather than something wrong.** An empty array is the
 *    signal the panel uses to offer the ticket form instead of an answer. If a
 *    scoring change made every query clear `MIN_SCORE`, the panel would start
 *    confidently mis-answering questions about locked grade sheets and the
 *    escalation path would go dead — silently, with no test failing.
 * 2. **Role visibility is per-topic.** A teacher must never be shown a topic
 *    that describes a school head's screen, and Super Admin sees everything
 *    because that role passes every check in this app by design.
 *
 * Both are asserted here, along with the ordering rules the panel depends on to
 * put the best answer first.
 */

describe("tokenize", () => {
  it("lowercases, drops punctuation, stop words, and single characters", () => {
    // "why", "is" and "the" carry no signal in a question about a school app,
    // so what survives is the part that actually names a topic.
    expect(tokenize("Why is the WEEK locked?!")).toEqual(["week", "locked"]);
    expect(tokenize("I need a report")).toEqual(["need", "report"]);
  });

  it("returns nothing for punctuation alone", () => {
    expect(tokenize("???")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("answerQuery", () => {
  it("finds the locked-week topic from how a teacher would actually ask", () => {
    const [best] = answerQuery("my week is locked and I cannot save", {
      role: "TEACHER",
    });
    expect(best?.topic.id).toBe("attendance-week-locked");
  });

  it("returns an empty array when nothing clears the threshold", () => {
    // The signal the panel turns into "I could not find that, send it to the
    // division admin". Not a low-scoring guess — nothing at all.
    expect(answerQuery("pizza delivery schedule")).toEqual([]);
    expect(answerQuery("zzzzzz")).toEqual([]);
  });

  it("returns an empty array for an empty query", () => {
    expect(answerQuery("")).toEqual([]);
    expect(answerQuery("   ")).toEqual([]);
  });

  it("scores every returned match at or above MIN_SCORE", () => {
    const matches = answerQuery("how do I request access to a closed term");
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(match.score).toBeGreaterThanOrEqual(MIN_SCORE);
    }
  });

  it("orders matches by descending score", () => {
    const matches = answerQuery("attendance week locked deadline", {
      role: "TEACHER",
    });
    const scores = matches.map((m) => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("honours the limit", () => {
    expect(answerQuery("attendance", { role: "TEACHER" }, 1)).toHaveLength(1);
    expect(
      answerQuery("attendance", { role: "TEACHER" }, 2).length
    ).toBeLessThanOrEqual(2);
  });

  it("never shows a teacher a school-head-only topic", () => {
    // `sh-approve-teachers` is scoped to SCHOOL_HEAD. Asking about it in a
    // teacher's words must not surface it — a teacher has no such screen.
    const ids = answerQuery("approve pending teachers", { role: "TEACHER" }).map(
      (m) => m.topic.id
    );
    expect(ids).not.toContain("sh-approve-teachers");

    const headIds = answerQuery("approve pending teachers", {
      role: "SCHOOL_HEAD",
    }).map((m) => m.topic.id);
    expect(headIds).toContain("sh-approve-teachers");
  });

  it("shows Super Admin every topic, including other roles' screens", () => {
    // Super Admin passes every role check in this app (impersonation), and the
    // help index follows the same rule rather than inventing a second one.
    const ids = answerQuery("approve pending teachers", {
      role: "SUPER_ADMIN",
    }).map((m) => m.topic.id);
    expect(ids).toContain("sh-approve-teachers");
  });

  it("prefers the on-route topic when two topics tie on words", () => {
    // The route boost only breaks ties; it must never pull an unrelated topic in.
    const onRoute = answerQuery("locked", {
      role: "TEACHER",
      pathname: "/teacher/aral/g7/attendance",
    });
    const offRoute = answerQuery("locked", { role: "TEACHER" });
    const onScore =
      onRoute.find((m) => m.topic.id === "attendance-week-locked")?.score ?? 0;
    const offScore =
      offRoute.find((m) => m.topic.id === "attendance-week-locked")?.score ?? 0;
    expect(onScore).toBeGreaterThan(offScore);
  });
});

describe("findTopic", () => {
  it("returns the topic a quick-action tile names", () => {
    expect(findTopic("request-unlock-how")?.id).toBe("request-unlock-how");
  });

  it("returns null for an unknown id rather than throwing", () => {
    // A tile pointing at a deleted topic must render "I do not know", not crash
    // the panel.
    expect(findTopic("no-such-topic")).toBeNull();
  });

  it("refuses a topic the role cannot see", () => {
    expect(findTopic("sh-approve-teachers", { role: "TEACHER" })).toBeNull();
    expect(findTopic("sh-approve-teachers", { role: "SCHOOL_HEAD" })).not.toBeNull();
  });
});

describe("suggestTopics", () => {
  it("returns role-appropriate topics with no query at all", () => {
    const teacher = suggestTopics({ role: "TEACHER" });
    expect(teacher.length).toBeGreaterThan(0);
    expect(teacher.every((t) => !t.roles || t.roles.includes("TEACHER"))).toBe(true);
  });

  it("honours the limit", () => {
    expect(suggestTopics({ role: "TEACHER" }, 2)).toHaveLength(2);
  });
});

describe("the topic index itself", () => {
  it("has unique ids", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every topic keywords and a body", () => {
    // A topic with no keywords is unreachable by search, and one with no body
    // renders an empty bubble. Both are silent failures in the panel.
    for (const topic of HELP_TOPICS) {
      expect(topic.keywords.length, topic.id).toBeGreaterThan(0);
      expect(topic.body.length, topic.id).toBeGreaterThan(0);
      expect(topic.title.length, topic.id).toBeGreaterThan(0);
    }
  });

  it("keeps topic bodies free of markup", () => {
    // Bodies are rendered as escaped text, never as HTML or Markdown. A stray
    // tag would be shown to the reader verbatim.
    for (const topic of HELP_TOPICS) {
      for (const paragraph of topic.body) {
        expect(paragraph, topic.id).not.toMatch(/<[a-z/]/i);
      }
    }
  });

  it("points every action at an in-app path", () => {
    for (const topic of HELP_TOPICS) {
      if (!topic.action) continue;
      expect(topic.action.href, topic.id).toMatch(/^\//);
    }
  });
});
