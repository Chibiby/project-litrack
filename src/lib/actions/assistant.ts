"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { answerQuery } from "@/lib/help/search";
import { askGemini, geminiConfigured } from "@/lib/assistant/gemini";
import { buildAssistantScope } from "@/lib/assistant/scope";
import { buildSystemInstruction } from "@/lib/assistant/prompt";

/**
 * The assistant's answer. There is no other one.
 *
 * This used to be the better half of a pair: the panel rendered a curated
 * answer from the offline index immediately and this action's prose replaced it
 * a second later. Two answers to one question, the first of which was visibly
 * rewritten in front of the reader — so the panel now waits for this, and this
 * either answers or says why it cannot.
 *
 * "Cannot" has to stay honest and has to stay safe. Every failure — no key, no
 * school, over the rate limit, Gemini down, slow, or refusing — comes back as a
 * fixed sentence written for a teacher, pointing at the division admin, who is
 * the real fallback now that the offline index no longer speaks.
 */

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const askSchema = z.object({
  question: z.string().trim().min(2, "Ask a question first").max(500, "Keep it shorter"),
  /** Pathname the question was asked from. A path only — never a query string. */
  pathname: z
    .string()
    .regex(/^\/(?!\/)[A-Za-z0-9\-._~/]*$/, "Invalid path")
    .optional(),
});

/** A link under the answer. The app's own route, never a model's invention. */
export type AssistantLink = { label: string; href: string };

export type AssistantAnswer = {
  text: string;
  /**
   * Where to actually go, from the topics the answer was grounded in.
   *
   * Resolved here rather than in the panel so the browser no longer has to ship
   * the whole help index to render two buttons — and so the model can never be
   * the source of a URL. Rule 6 of the system instruction forbids it printing
   * one; these come from `HELP_TOPICS` on the server either way.
   */
  links: AssistantLink[];
};

/** Shown verbatim in the panel. Fixed copy — never an exception's message. */
const UNAVAILABLE =
  "I could not reach the assistant just now. Try again in a moment, or send your question to the division admin.";
const NOT_CONFIGURED =
  "The assistant is not switched on for this deployment, so I cannot answer questions here yet. Your division admin can still help.";
const NO_SCHOOL =
  "I answer from a school's own data, and this admin account is not attached to one. Open a school first and ask from there.";
const RATE_LIMITED =
  "That is a lot of questions in one hour. Give it a little while, or send this one to the division admin.";

/**
 * Twenty questions an hour per person.
 *
 * Not a security boundary — it is a bill. A component stuck in a render loop
 * calling a metered API is the failure this exists to bound, and no teacher
 * types twenty genuine questions in an hour.
 */
const RATE_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };

/** How many links an answer carries. The panel has room for a couple. */
const MAX_LINKS = 2;

export async function askAssistant(input: unknown): Promise<ActionResult<AssistantAnswer>> {
  const user = await requireUser();

  const parsed = askSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { question, pathname } = parsed.data;

  if (!geminiConfigured()) return { ok: false, error: NOT_CONFIGURED };

  // Super Admin holds no school of their own, so there is no "their learners"
  // to describe, and this path must never carry an admin-wide or cross-school
  // scope. They read a school's data from that school's own pages.
  if (!user.schoolId) return { ok: false, error: NO_SCHOOL };

  const limit = await checkRateLimit(`assistant:${user.id}`, RATE_LIMIT);
  if (!limit.ok) return { ok: false, error: RATE_LIMITED };

  // The ranker no longer picks what the prompt contains — every topic the role
  // can see is quoted in full now. It still orders them, and it still decides
  // which two "Open Learners" style links sit under the answer.
  const matches = answerQuery(question, { role: user.role, pathname }, 6);
  const topicIds = matches.map((match) => match.topic.id);
  const links = matches
    .filter((match) => match.topic.action)
    .slice(0, MAX_LINKS)
    .map((match) => ({ label: match.topic.action!.label, href: match.topic.action!.href }));

  try {
    const scope = await buildAssistantScope({ ...user, schoolId: user.schoolId });
    const result = await askGemini(buildSystemInstruction(scope, topicIds), question);
    if (!result) return { ok: false, error: UNAVAILABLE };

    // Counts and ids only. The question can name a learner and the answer can
    // repeat it, so neither is ever written to the audit log.
    await writeAudit({
      action: AUDIT_ACTIONS.ASSISTANT_AI_QUERY,
      resource: "Assistant",
      userId: user.id,
      schoolId: user.schoolId,
      metadata: {
        promptTokens: result.promptTokens,
        answerTokens: result.answerTokens,
        groundedIn: topicIds.length,
      },
    });

    return { ok: true, data: { text: result.text, links } };
  } catch (error) {
    // A scope query that fails must not take the panel with it.
    console.error("[assistant] scope or answer failed", error);
    return { ok: false, error: UNAVAILABLE };
  }
}
