import { describe, expect, it } from "vitest";
import {
  MAX_FULL_TOPICS,
  buildSystemInstruction,
  learnerLabel,
  type AssistantScope,
} from "@/lib/assistant/prompt";
import { HELP_TOPICS } from "@/lib/help/topics";

/**
 * What the model is allowed to be told.
 *
 * This is the one code path in LITRACK that hands school data to a third party,
 * so the assertions here are about exclusion as much as inclusion: a prompt that
 * merely *works* is not good enough if it also carries an LRN, a birthdate, or
 * another teacher's learner.
 *
 * `buildSystemInstruction` is pure, which is what makes that testable at all —
 * the scope is data, so a test can hand it a hostile one.
 */

const scope: AssistantScope = {
  role: "TEACHER",
  firstName: "Marivic",
  schoolName: "Malandag Central Elementary",
  today: "2026-09-10",
  currentWeekLabel: "September 7 – September 13, 2026",
  currentMonthLabel: "September 2026",
  learnerCount: 16,
  aralLearnerCount: 16,
  breakdown: [{ gradeLabel: "Grade 3", sectionName: "Mango", count: 16 }],
  attendance: {
    weekLabel: "September 7 – September 13, 2026",
    present: 60,
    absent: 4,
    late: 2,
    excused: 1,
    unmarked: 13,
  },
  readingLevel: { monthLabel: "September 2026", assessed: 0, total: 16 },
  pendingProfiles: [
    { label: "Asriel A.", gradeLabel: "Grade 3", sectionName: "Mango" },
  ],
  pendingProfilesTruncated: false,
};

describe("learnerLabel", () => {
  it("gives a first name and a last initial, never a full name", () => {
    expect(learnerLabel("Asriel Gabby", "Andrews")).toBe("Asriel Gabby A.");
    expect(learnerLabel("Blair", "Oirada")).toBe("Blair O.");
  });

  it("survives a missing surname rather than emitting a stray dot", () => {
    expect(learnerLabel("Blair", "")).toBe("Blair");
    expect(learnerLabel("Blair", "   ")).toBe("Blair");
  });
});

describe("buildSystemInstruction", () => {
  it("grounds the model and forbids inventing rules", () => {
    const prompt = buildSystemInstruction(scope);
    expect(prompt).toContain("Answer only from the REFERENCE and CONTEXT");
    expect(prompt).toMatch(/never invent a screen, button, field, menu or rule/i);
    // The app's whole "no rule we do not enforce" position, restated for a model
    // that would otherwise supply plausible school-software behaviour.
    expect(prompt).toMatch(/never state a deadline, lock, permission or approval rule/i);
  });

  it("carries the asker's own scope", () => {
    const prompt = buildSystemInstruction(scope);
    expect(prompt).toContain("Malandag Central Elementary");
    expect(prompt).toContain("16");
    expect(prompt).toContain("Asriel A.");
    expect(prompt).toContain("September 7 – September 13, 2026");
  });

  it("says so plainly when there is nothing to report", () => {
    // A pilot school in week one has no records at all, and an absent section
    // reads to a model as "unknown", which it will happily fill in.
    const empty = buildSystemInstruction({
      ...scope,
      attendance: null,
      readingLevel: null,
      pendingProfiles: [],
    });
    expect(empty).toContain("no records for the current week");
    expect(empty).toContain("no records for the current month");
    expect(empty).toContain("no ARAL profile yet: none");
  });

  it("quotes only the ranked topics in full, and lists the rest by title", () => {
    // The token budget. A question about attendance must not pay for the body
    // text of every reports and account topic.
    const ranked = ["attendance-mark-week", "attendance-week-locked"];
    const prompt = buildSystemInstruction(scope, ranked);

    // A ranked topic's body is present...
    const marked = HELP_TOPICS.find((t) => t.id === "attendance-mark-week")!;
    expect(prompt).toContain(marked.body[0]);

    // ...an unranked one's is not, though its title still is, so the model can
    // say "that exists" rather than guessing at the detail.
    const password = HELP_TOPICS.find((t) => t.id === "account-password")!;
    expect(prompt).not.toContain(password.body[0]);
    expect(prompt).toContain(password.title);
  });

  it("still grounds on something when the ranker matched nothing", () => {
    const prompt = buildSystemInstruction(scope, []);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain("REFERENCE");
  });

  it("never quotes more than the cap in full", () => {
    const everyId = HELP_TOPICS.map((t) => t.id);
    const prompt = buildSystemInstruction(scope, everyId);
    const quoted = HELP_TOPICS.filter((topic) => prompt.includes(topic.body[0]));
    expect(quoted.length).toBeLessThanOrEqual(MAX_FULL_TOPICS);
  });

  it("shows a teacher no school-head-only topic", () => {
    // The same role rule the offline index applies. A teacher's prompt must not
    // describe a screen they do not have, or the model will tell them to open it.
    const prompt = buildSystemInstruction(scope, ["sh-approve-teachers"]);
    expect(prompt).not.toContain("sh-approve-teachers");
  });

  it("cannot carry a full name, an LRN, a birthdate or an email", () => {
    // Not a formatting preference. `AssistantScope` has no field for any of
    // these, so this asserts the shape of the boundary: if someone adds one,
    // this test is where it is noticed.
    const prompt = buildSystemInstruction(scope);

    expect(prompt).not.toMatch(/\b\d{12}\b/); // an LRN

    // Exactly one ISO date in the whole prompt: the "Today:" line. A second one
    // would mean a birthdate had found its way in.
    const isoDates = prompt.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
    expect(isoDates).toEqual(["2026-09-10"]);

    expect(prompt).not.toContain("@"); // no email address
    expect(prompt).not.toContain("Andrews"); // the surname behind "Asriel A."
  });

  it("admits when a list was cut short", () => {
    // A truncated list read as complete is how "you have 25 pending" becomes a
    // confident wrong answer.
    const truncated = buildSystemInstruction({
      ...scope,
      pendingProfilesTruncated: true,
    });
    expect(truncated).toMatch(/only the first \d+ are listed/);
  });
});
