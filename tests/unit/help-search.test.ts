import { describe, expect, it } from "vitest";
import {
  detectSmallTalk,
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

describe("small talk", () => {
  // "hi" used to score three unrelated topics — including "A learner left. Do
  // I delete them?" — and "hello" scored nothing, which sent people to the
  // ticket form to say hello. One of those tickets is still in the pilot data.
  it("recognises greetings and thanks as the whole message", () => {
    for (const greeting of ["hi", "Hello!", "  hey  ", "Good morning", "kumusta"]) {
      expect(detectSmallTalk(greeting), greeting).toBe("greeting");
    }
    for (const thanks of ["thanks", "Thank you", "salamat", "thx"]) {
      expect(detectSmallTalk(thanks), thanks).toBe("thanks");
    }
  });

  it("does not treat a real question as small talk because it opens with one", () => {
    expect(detectSmallTalk("hi how do i mark attendance")).toBeNull();
    expect(detectSmallTalk("thanks but the week is still locked")).toBeNull();
  });

  it("answers no topics for small talk, so the panel replies in words", () => {
    expect(answerQuery("hi", { role: "TEACHER" })).toEqual([]);
    expect(answerQuery("salamat", { role: "TEACHER" })).toEqual([]);
  });
});

/**
 * The audit table.
 *
 * Every row is a question a teacher actually types, checked against what the
 * index should say. Each was verified by hand; several are here because the
 * assistant used to answer them wrongly, and a regression would be invisible
 * without a named expectation.
 *
 * `null` means "answer nothing" and is as much a requirement as any id: silence
 * is what routes the person to a human, and an index that answers everything
 * has stopped being trustworthy.
 */
const AUDIT: { question: string; expect: string | null; why?: string }[] = [
  // Was: nothing at all — every word is a stop word, so the topic named after
  // this exact question could never be found by asking it.
  { question: "what can you do", expect: "assistant-what-can-you-do" },

  // Was: "How do I find or update a learner?" — adding is not finding.
  { question: "how do i add a learner", expect: "learner-add" },
  { question: "how do i add a new learner", expect: "learner-add" },

  // Was: nothing. Both shipped before the index knew about them.
  { question: "nutritional status", expect: "learner-nutritional-status" },
  { question: "what is severely wasted", expect: "learner-nutritional-status" },
  { question: "reasons of absenteeism", expect: "attendance-absence-reasons" },

  // Was: "How do I find or update a learner?"
  { question: "why is a learner absent", expect: "attendance-absence-reasons" },
  { question: "how do i enroll a learner to aral", expect: "aral-enroll" },
  { question: "how do i edit my profile", expect: "account-profile" },

  // Was: nothing, or the closest unrelated topic.
  { question: "what is aral", expect: "aral-what-is" },
  { question: "import csv", expect: "learner-import" },
  { question: "how do i log out", expect: "account-sign-in-out" },
  { question: "who is my school head", expect: "who-to-ask" },

  // These were already right and must stay right.
  { question: "how do i mark attendance", expect: "attendance-mark-week" },
  { question: "why is the week locked", expect: "attendance-week-locked" },
  { question: "how do i unlock a week", expect: "request-unlock-how" },
  { question: "how do i change reading level", expect: "reading-level-monthly" },
  { question: "how do i print a report", expect: "reports-generate" },
  { question: "report is empty", expect: "reports-empty" },
  { question: "i forgot my password", expect: "account-password" },
  { question: "dark mode", expect: "theme-dark-mode" },
  { question: "can i delete a learner", expect: "learner-archive" },

  // Silence is the right answer: the app has nothing to say about these, and a
  // guess would be worse than the ticket form.
  { question: "the app is slow", expect: null, why: "was: account-pending-approval" },
  { question: "pizza delivery schedule", expect: null },
];

describe("the audit table", () => {
  for (const row of AUDIT) {
    const label = row.expect
      ? `answers "${row.question}" with ${row.expect}`
      : `stays silent on "${row.question}"`;
    it(label, () => {
      const matches = answerQuery(row.question, { role: "TEACHER" });
      if (row.expect === null) {
        expect(matches, row.why ?? row.question).toEqual([]);
        return;
      }
      expect(matches[0]?.topic.id, row.why ?? row.question).toBe(row.expect);
    });
  }

  it("never offers a runner-up that is out of the winner's league", () => {
    // A right answer followed by an unrelated one reads as a guess. "how do i
    // change reading level" used to answer correctly and then offer "How do I
    // change my password?" underneath it.
    for (const row of AUDIT) {
      const matches = answerQuery(row.question, { role: "TEACHER" });
      if (matches.length < 2) continue;
      const best = matches[0].score;
      for (const match of matches.slice(1)) {
        expect(match.score * 2, `${row.question} → ${match.topic.id}`).toBeGreaterThanOrEqual(best);
      }
    }
  });
});
