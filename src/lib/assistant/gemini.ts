import "server-only";
import { getServerEnv } from "@/lib/env";

/**
 * The Gemini call, and nothing else.
 *
 * One rule governs this module: **it never throws and never returns a partial
 * answer.** Every failure — no key, a network error, a timeout, a spent quota,
 * a safety block, a malformed response — comes back as `null`, and `null` is
 * what makes the caller fall back to the curated index. The assistant existed
 * and worked before this file did; nothing here is allowed to take that away.
 *
 * That is also why there is no SDK. A `fetch` with an `AbortSignal` is the
 * whole client, it adds no dependency to audit, and it cannot surprise us with
 * its own retry or logging behaviour.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * How long a teacher waits before getting the offline answer instead.
 *
 * Eight seconds is past the point where a chat panel feels broken. The curated
 * index answers in the same frame, so the cost of giving up is one good answer
 * instead of a better one — not an error.
 */
const TIMEOUT_MS = 8_000;

export type GeminiResult = {
  text: string;
  /** For audit: counts only, never content. */
  promptTokens: number;
  answerTokens: number;
};

/** Whether a model backend is configured at all. */
export function geminiConfigured(): boolean {
  return Boolean(getServerEnv().GEMINI_API_KEY);
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

/**
 * Ask Gemini one grounded question. Returns null on any failure at all.
 */
export async function askGemini(
  systemInstruction: string,
  question: string
): Promise<GeminiResult | null> {
  const env = getServerEnv();
  const key = env.GEMINI_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `${ENDPOINT}/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: question }] }],
          generationConfig: {
            // Low, not zero: this is a help desk, not a creative writing tool,
            // and a wandering answer about a locked grade sheet is the failure
            // mode that matters here.
            temperature: 0.2,
            // Two or three sentences, as the system instruction asks for. A cap
            // is also the cheapest guard against a runaway bill.
            maxOutputTokens: 400,
          },
        }),
      }
    );

    if (!response.ok) {
      // Body deliberately not logged: a 400 from this API echoes the request,
      // and the request contains the person's own class data.
      console.error(`[assistant] Gemini returned ${response.status}`);
      return null;
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    // An empty candidate list is what a safety block looks like. It is a
    // failure like any other: fall back rather than render an empty bubble.
    if (!text) return null;

    return {
      text,
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      answerTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    console.error(`[assistant] Gemini ${aborted ? "timed out" : "call failed"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
