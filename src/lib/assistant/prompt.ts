import type { UserRole } from "@prisma/client";
import { HELP_TOPICS } from "@/lib/help/topics";
import { APP_VERSION, RELEASES } from "@/lib/releases";

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
 *
 * Since the model became the assistant's only voice, this prompt is also the
 * only thing standing between a question and no answer at all. That is why it
 * now carries the *whole* help index rather than a ranked slice, and why it
 * carries the release notes and the live state of the deadline switch: whatever
 * the team changed this release, the model is told about it on the next
 * question, without anyone re-tuning a prompt.
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
  /**
   * Whether editing deadlines are switched on right now.
   *
   * The help index describes locks as a thing that exists, because they do —
   * but `submissions.locking` decides whether they are *enforced today*, and a
   * model told only about the feature will confidently tell a teacher their
   * week is locked while the app is happily saving it. The most change-prone
   * rule in the app, so it is sent as live state rather than baked into prose.
   */
  submissionLockingEnabled: boolean;
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

/** How many releases back the "what changed" block reaches. */
export const MAX_RELEASE_NOTES = 5;

/**
 * The knowledge base, flattened for grounding.
 *
 * Every topic the asker's role can see, quoted in full, every time.
 *
 * It used to be six. That was the right trade when an offline ranker answered
 * alongside the model and a mismatched rank only cost a slightly worse second
 * answer. Now the model is the only answer there is, and a topic left out of
 * the prompt is a question the assistant simply cannot answer — so the budget
 * moved from "quote the six we guessed at" to "quote everything, cheaply".
 *
 * `relevantIds` no longer decides what is included, only what comes first.
 * Order still matters to a model, and the ranker is still the best available
 * guess at what the question is about.
 */
function knowledgeBase(role: UserRole, relevantIds: string[]): string {
  const visible = HELP_TOPICS.filter(
    (topic) =>
      !topic.roles || topic.roles.length === 0 || role === "SUPER_ADMIN" || topic.roles.includes(role)
  );

  // Ranked topics float to the top; everything else keeps the index's own
  // order, which groups topics by subject. `sort` is stable, so ties hold.
  const rank = new Map(relevantIds.map((id, index) => [id, index]));
  const ordered = [...visible].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );

  return ordered
    .map((topic) => {
      const action = topic.action ? `\n  Where: ${topic.action.label} (${topic.action.href})` : "";
      return `- [${topic.id}] ${topic.title}\n  ${topic.body.join("\n  ")}${action}`;
    })
    .join("\n");
}

/**
 * What changed in the app recently, in the users' own words.
 *
 * `RELEASES` is committed copy that a release is required to update in the same
 * commit as the work it describes. Reading it here is what makes "keep the
 * assistant current" something that happens by shipping, rather than a prompt
 * somebody has to remember to re-tune. It is also the only way this panel can
 * answer "why does this page look different today", which is the question a
 * teacher actually asks the morning after a deploy.
 *
 * Release dates are deliberately omitted. A release date is a `YYYY-MM-DD`
 * string, and part of what keeps this module's privacy boundary testable is
 * that exactly one ISO date appears in the whole prompt: the "Today:" line.
 */
function releaseNotes(): string {
  const lines = [`LITRACK is currently at version ${APP_VERSION}.`];

  for (const release of RELEASES.slice(0, MAX_RELEASE_NOTES)) {
    lines.push(`Version ${release.version} — ${release.title}`);
    for (const fix of release.fixes) lines.push(`  - ${fix}`);
  }

  return lines.join("\n");
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

  lines.push(
    scope.submissionLockingEnabled
      ? "Editing deadlines: ON. Past weeks and closed terms are locked, and reopening one needs a request to the division admin."
      : "Editing deadlines: OFF. Every attendance week and term grade sheet is editable right now, past ones included, and nobody needs to request access to edit one. Say so plainly if asked, even though the reference describes how locks behave when they are on."
  );

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
  /** Topic ids the ranker matched, best first. Ordering only — all are quoted. */
  relevantIds: string[] = []
): string {
  return [
    "You are the LITRACK assistant. LITRACK is a DepEd school management app used by Philippine public elementary schools to track learners in the ARAL reading remediation programme.",
    "",
    "RULES, in order of importance:",
    "1. Answer only from the REFERENCE, CHANGES and CONTEXT below. If they do not contain the answer, say plainly that you do not know and suggest sending the question to the division admin with Request Access. Never invent a screen, button, field, menu or rule that is not described below.",
    "2. Never state a deadline, lock, permission or approval rule that is not in the REFERENCE. The app enforces only what is written there, and the CONTEXT line about editing deadlines overrides the REFERENCE on whether locks apply today.",
    "3. The CONTEXT describes only this person's own learners. Never claim to know about another teacher, another school, or the division as a whole.",
    "4. You are the only assistant here, so answer every message — a greeting and a thank-you included. Greet the person back by name in one short line and invite their question; never answer small talk with help articles.",
    "5. Be brief: two or three short sentences. This renders in a small chat panel on a phone.",
    "6. Write plain text. No markdown, no bullet characters, no headings. Name screens the way the sidebar names them (\"Weekly Attendance\"); never print a URL or a path — the panel renders the link itself.",
    "7. Answer in the language the question is asked in. English and Filipino are both normal here.",
    "",
    "REFERENCE — what LITRACK does:",
    knowledgeBase(scope.role, relevantIds),
    "",
    "CHANGES — what is new in this app, newest first. Use this for any question about what changed, what is new, or why something behaves differently than it used to:",
    releaseNotes(),
    "",
    "CONTEXT — the person asking, and their own data only:",
    scopeBlock(scope),
  ].join("\n");
}
