import type { UserRole } from "@prisma/client";
import { HELP_TOPICS } from "@/lib/help/topics";

/**
 * The prompt sent to Gemini, built as a pure function.
 *
 * This module is the privacy boundary in one file. Everything the model is ever
 * told is assembled here from an `AssistantScope` the caller has already
 * narrowed, and nothing in here reads the database — so "what can leave the
 * country" is a question answered by reading one type and one function, not by
 * auditing every call site.
 *
 * Two rules it exists to enforce:
 *
 * 1. **Only the asker's own scope.** `AssistantScope` carries counts, rates and
 *    the asker's own pending learners. It has no field for another school, and
 *    the caller in `scope.ts` builds it from queries already filtered by
 *    `schoolId` and the teacher's learner scope. A prompt cannot leak what the
 *    type cannot hold.
 * 2. **No identifiers that outlive the answer.** No LRNs, no learner ids, no
 *    email addresses, no birthdates. First name and last initial are enough for
 *    a teacher to recognise their own pupil in a list of twenty, and are
 *    useless to anyone who is not that teacher.
 */

/** A learner as the model is allowed to see them: recognisable, not identifying. */
export type ScopeLearner = {
  /** `"Maria S."` — first name and last initial. Never a full name or an LRN. */
  label: string;
  gradeLabel: string;
  sectionName: string | null;
};

export type AssistantScope = {
  role: UserRole;
  /** The asker's own first name, for addressing them. */
  firstName: string;
  schoolName: string;
  /** Local `YYYY-MM-DD`, so the model can reason about "this week" correctly. */
  today: string;
  currentWeekLabel: string;
  currentMonthLabel: string;
  learnerCount: number;
  aralLearnerCount: number;
  /** Per grade and section, for "how many in Grade 3 Mango". */
  breakdown: { gradeLabel: string; sectionName: string | null; count: number }[];
  attendance: {
    weekLabel: string;
    present: number;
    absent: number;
    late: number;
    excused: number;
    unmarked: number;
  } | null;
  readingLevel: { monthLabel: string; assessed: number; total: number } | null;
  /** Learners in the asker's scope with no ARAL profile yet. Capped. */
  pendingProfiles: ScopeLearner[];
  /** True when the list above was cut short, so the model does not imply it is all. */
  pendingProfilesTruncated: boolean;
};

/** How many learners a scope block will name. Beyond this it reports a count. */
export const MAX_NAMED_LEARNERS = 25;

/** `"Maria S."` from a first and last name. Empty parts are simply dropped. */
export function learnerLabel(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const initial = lastName.trim().charAt(0);
  if (!initial) return first;
  return `${first} ${initial.toUpperCase()}.`;
}

/** Topics quoted in full. Beyond this the model gets titles only. */
export const MAX_FULL_TOPICS = 6;

/**
 * The knowledge base, flattened for grounding.
 *
 * Not the whole index. The offline ranker already knows which topics a question
 * is about, so the prompt quotes those in full and lists the rest by title
 * alone — the model still knows every subject the app covers and can say "that
 * exists, ask it this way", but a question about attendance does not pay for
 * the text of every reports and account topic on every request.
 *
 * Sending the index at all is what makes the model answer about LITRACK as it
 * actually is rather than about school software in general.
 */
function knowledgeBase(role: UserRole, relevantIds: string[]): string {
  const visible = HELP_TOPICS.filter(
    (topic) =>
      !topic.roles || topic.roles.length === 0 || role === "SUPER_ADMIN" || topic.roles.includes(role)
  );

  const ranked = relevantIds.slice(0, MAX_FULL_TOPICS);
  const full = visible.filter((topic) => ranked.includes(topic.id));
  const rest = visible.filter((topic) => !ranked.includes(topic.id));

  const quoted = (full.length > 0 ? full : visible.slice(0, MAX_FULL_TOPICS)).map((topic) => {
    const action = topic.action ? `\n  Where: ${topic.action.label} (${topic.action.href})` : "";
    return `- [${topic.id}] ${topic.title}\n  ${topic.body.join("\n  ")}${action}`;
  });

  const listed = rest.map((topic) => `- [${topic.id}] ${topic.title}`);

  return [
    quoted.join("\n"),
    listed.length > 0
      ? `\nOther subjects this app covers, titles only. If the answer is one of these, say so and name it rather than guessing at the detail:\n${listed.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function scopeBlock(scope: AssistantScope): string {
  const lines: string[] = [
    `Signed in as: ${scope.firstName} (${scope.role})`,
    `School: ${scope.schoolName}`,
    `Today: ${scope.today}`,
    `Current week: ${scope.currentWeekLabel}`,
    `Current month: ${scope.currentMonthLabel}`,
    `Learners in their care: ${scope.learnerCount} (${scope.aralLearnerCount} in ARAL)`,
  ];

  if (scope.breakdown.length > 0) {
    lines.push("By grade and section:");
    for (const row of scope.breakdown) {
      lines.push(`  - ${row.gradeLabel}${row.sectionName ? ` ${row.sectionName}` : ""}: ${row.count}`);
    }
  }

  if (scope.attendance) {
    const a = scope.attendance;
    lines.push(
      `Attendance for ${a.weekLabel}: present ${a.present}, absent ${a.absent}, late ${a.late}, excused ${a.excused}, not yet marked ${a.unmarked}`
    );
  } else {
    lines.push("Attendance: no records for the current week.");
  }

  if (scope.readingLevel) {
    const r = scope.readingLevel;
    lines.push(
      `Reading level for ${r.monthLabel}: ${r.assessed} of ${r.total} learners assessed`
    );
  } else {
    lines.push("Reading level: no records for the current month.");
  }

  if (scope.pendingProfiles.length > 0) {
    lines.push("Learners with no ARAL profile yet:");
    for (const learner of scope.pendingProfiles) {
      lines.push(
        `  - ${learner.label} (${learner.gradeLabel}${learner.sectionName ? ` ${learner.sectionName}` : ""})`
      );
    }
    if (scope.pendingProfilesTruncated) {
      lines.push(`  - ...and more; only the first ${MAX_NAMED_LEARNERS} are listed.`);
    }
  } else {
    lines.push("Learners with no ARAL profile yet: none.");
  }

  return lines.join("\n");
}

/**
 * The system instruction.
 *
 * The grounding rule at the top is the one that matters. This panel's whole
 * design is that it says nothing rather than something wrong — a school app
 * that confidently mis-answers a question about a locked grade sheet is worse
 * than one that stays quiet — and a model has to be told that explicitly or it
 * will fill the gap with plausible school-software behaviour that this app does
 * not have.
 */
export function buildSystemInstruction(
  scope: AssistantScope,
  /** Topic ids the offline ranker matched, best first. Quoted in full. */
  relevantIds: string[] = []
): string {
  return [
    "You are the LITRACK assistant. LITRACK is a DepEd school management app used by Philippine public elementary schools to track learners in the ARAL reading remediation programme.",
    "",
    "RULES, in order of importance:",
    "1. Answer only from the REFERENCE and CONTEXT below. If they do not contain the answer, say plainly that you do not know and suggest sending the question to the division admin with Request Access. Never invent a screen, button, field, menu or rule that is not described below.",
    "2. Never state a deadline, lock, permission or approval rule that is not in the REFERENCE. The app enforces only what is written there.",
    "3. The CONTEXT describes only this person's own learners. Never claim to know about another teacher, another school, or the division as a whole.",
    "4. Be brief: two or three short sentences. This renders in a small chat panel on a phone.",
    "5. Write plain text. No markdown, no bullet characters, no headings. Name screens the way the sidebar names them (\"Weekly Attendance\"); never print a URL or a path — the panel renders the link itself.",
    "6. Answer in the language the question is asked in. English and Filipino are both normal here.",
    "",
    "REFERENCE — what LITRACK does:",
    knowledgeBase(scope.role, relevantIds),
    "",
    "CONTEXT — the person asking, and their own data only:",
    scopeBlock(scope),
  ].join("\n");
}
