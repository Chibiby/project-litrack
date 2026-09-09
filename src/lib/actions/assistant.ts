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
 * The assistant's model-backed answer.
 *
 * The contract with the panel is narrow on purpose: this returns prose or it
 * returns nothing, and "nothing" means the panel falls back to the curated
 * index it has always used. Every failure lands there — no key, no school, over
 * the rate limit, Gemini down, Gemini slow, Gemini refusing. A teacher marking
 * attendance on a Friday afternoon must never see this panel break because a
 * third party is having an incident.
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

export type AssistantAnswer = {
  text: string;
  /** Topic ids the answer was grounded in, so the panel can show their links. */
  topicIds: string[];
};

/**
 * Twenty questions an hour per person.
 *
 * Not a security boundary — it is a bill. A component stuck in a render loop
 * calling a metered API is the failure this exists to bound, and no teacher
 * types twenty genuine questions in an hour.
 */
const RATE_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };

export async function askAssistant(input: unknown): Promise<ActionResult<AssistantAnswer>> {
  const user = await requireUser();

  const parsed = askSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { question, pathname } = parsed.data;

  // Nothing configured: not an error, just no model. The panel already has an
  // answer for this case and it is a good one.
  if (!geminiConfigured()) return { ok: false, error: "unavailable" };

  // Super Admin holds no school of their own, so there is no "their learners"
  // to describe. They get the curated index rather than an invented scope, or
  // worse, an admin-wide one — this path must never carry cross-school data.
  if (!user.schoolId) return { ok: false, error: "unavailable" };

  const limit = await checkRateLimit(`assistant:${user.id}`, RATE_LIMIT);
  if (!limit.ok) return { ok: false, error: "unavailable" };

  // The offline ranker picks what the prompt quotes in full, so a question
  // about attendance does not pay for the text of every account topic.
  const matches = answerQuery(question, { role: user.role, pathname }, 6);
  const topicIds = matches.map((match) => match.topic.id);

  try {
    const scope = await buildAssistantScope({ ...user, schoolId: user.schoolId });
    const result = await askGemini(buildSystemInstruction(scope, topicIds), question);
    if (!result) return { ok: false, error: "unavailable" };

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

    return { ok: true, data: { text: result.text, topicIds } };
  } catch (error) {
    // A scope query that fails must not take the panel with it.
    console.error("[assistant] scope or answer failed", error);
    return { ok: false, error: "unavailable" };
  }
}
