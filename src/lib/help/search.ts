import type { UserRole } from "@prisma/client";
import { HELP_TOPICS, type HelpTopic } from "./topics";

/**
 * Ranking for the assistant's curated help index.
 *
 * A pure function over `HELP_TOPICS` — no network, no server action, no state.
 * That is what lets the panel answer in the same frame the person presses
 * Enter, and what makes every answer reproducible in a unit test.
 *
 * `answerQuery` is the assistant's single entry point. If a model backend is
 * ever added, it replaces the body of this one function; the panel and the
 * ticket flow never learn the difference.
 */

/** Words carrying no signal in a question about a school app. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "get",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

/**
 * Score below which a match is not worth showing as an answer.
 *
 * Set so that a single incidental word overlap ("the report") does not produce
 * a confident-looking answer to a question the index cannot actually answer.
 * Falling under it is what routes a person to the ticket form instead, so this
 * threshold is the whole difference between a helpful bot and a misleading one.
 */
export const MIN_SCORE = 3;

export type HelpContext = {
  /** Current pathname, used only to boost topics about the page in view. */
  pathname?: string;
  role?: UserRole;
};

export type HelpMatch = {
  topic: HelpTopic;
  score: number;
};

/** Lowercase, strip punctuation, split, drop stop words and single characters. */
export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function isVisibleTo(topic: HelpTopic, role?: UserRole): boolean {
  if (!topic.roles || topic.roles.length === 0) return true;
  // Super Admin sees every role's pages by impersonation, so it sees every
  // role's help too — same rule `requireUser` applies to route access.
  if (role === "SUPER_ADMIN") return true;
  return role !== undefined && topic.roles.includes(role);
}

function matchesRoute(topic: HelpTopic, pathname?: string): boolean {
  if (!pathname || !topic.routes) return false;
  return topic.routes.some((route) => pathname.startsWith(route));
}

/**
 * How well one topic answers one tokenized question.
 *
 * The weights encode a simple claim: a word in the title is stronger evidence
 * than the same word buried in a paragraph, and an exact keyword — the terms
 * people actually type, including the DepEd vocabulary — is stronger still.
 * A whole-phrase hit in the title outranks any accumulation of single words,
 * because it means the person asked the question the topic is named after.
 */
function scoreTopic(
  topic: HelpTopic,
  tokens: string[],
  normalizedQuery: string,
  context: HelpContext
): number {
  const title = topic.title.toLowerCase();
  const body = topic.body.join(" ").toLowerCase();
  const keywords = topic.keywords.map((k) => k.toLowerCase());

  let score = 0;

  if (normalizedQuery.length > 2 && title.includes(normalizedQuery)) {
    score += 12;
  }
  if (normalizedQuery.length > 2 && keywords.some((k) => k === normalizedQuery)) {
    score += 10;
  }

  for (const token of tokens) {
    if (keywords.some((k) => k === token)) {
      score += 4;
    } else if (keywords.some((k) => k.includes(token))) {
      score += 2;
    }
    if (title.includes(token)) score += 3;
    if (body.includes(token)) score += 1;
  }

  // A tie between a general topic and one about the page in view goes to the
  // page in view. Small on purpose: a boost large enough to promote an
  // irrelevant topic would make the assistant answer the wrong question
  // confidently just because of where it was opened.
  if (score > 0 && matchesRoute(topic, context.pathname)) {
    score += 2;
  }

  return score;
}

/**
 * The ranked answers to a free-text question, best first.
 *
 * Returns an empty array when nothing clears `MIN_SCORE`. That empty result is
 * meaningful — it is the signal the panel uses to offer the ticket form rather
 * than guess.
 */
export function answerQuery(
  query: string,
  context: HelpContext = {},
  limit = 3
): HelpMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return HELP_TOPICS.filter((topic) => isVisibleTo(topic, context.role))
    .map((topic) => ({
      topic,
      score: scoreTopic(topic, tokens, normalizedQuery, context),
    }))
    .filter((match) => match.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id))
    .slice(0, limit);
}

/**
 * Topics to offer before anything has been typed: the ones about the page in
 * view first, then general ones, filtered to the role.
 *
 * Never empty for a signed-in user — the general topics have no role
 * restriction — so the panel always has something to show on first open.
 */
export function suggestTopics(context: HelpContext = {}, limit = 4): HelpTopic[] {
  const visible = HELP_TOPICS.filter((topic) => isVisibleTo(topic, context.role));
  const onPage = visible.filter((topic) => matchesRoute(topic, context.pathname));
  const rest = visible.filter((topic) => !onPage.includes(topic));
  return [...onPage, ...rest].slice(0, limit);
}

/** One topic by id, respecting role visibility. */
export function findTopic(id: string, context: HelpContext = {}): HelpTopic | null {
  const topic = HELP_TOPICS.find((t) => t.id === id);
  if (!topic || !isVisibleTo(topic, context.role)) return null;
  return topic;
}
