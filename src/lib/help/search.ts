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

/** Every word of a text, stop words kept — the unit title and body match on. */
function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

type TopicIndex = {
  titleWords: Set<string>;
  bodyWords: Set<string>;
  title: string;
  keywords: string[];
};

/**
 * Whole-word indexes, built once.
 *
 * Title and body used to be matched with `String.includes`, which matches
 * inside words: "app" hit "approval", so "the app is slow" was answered with
 * "My account says it is waiting for approval". Words, not substrings.
 */
const TOPIC_INDEX = new Map<string, TopicIndex>();

function indexOf(topic: HelpTopic): TopicIndex {
  let entry = TOPIC_INDEX.get(topic.id);
  if (!entry) {
    entry = {
      title: topic.title.toLowerCase(),
      titleWords: new Set(words(topic.title)),
      bodyWords: new Set(words(topic.body.join(" "))),
      keywords: topic.keywords.map((k) => k.toLowerCase()),
    };
    TOPIC_INDEX.set(topic.id, entry);
  }
  return entry;
}

/**
 * Openers that are not questions about the app.
 *
 * Matched only as the whole message: "hi" is a greeting, "hi how do I mark
 * attendance" is a question. Without this, "hi" scored three unrelated topics —
 * including "A learner left. Do I delete them?" — and "hello" scored nothing at
 * all, which sent people to the ticket form to say hello.
 */
const GREETINGS = new Set([
  "hi",
  "hii",
  "hey",
  "hello",
  "helo",
  "yo",
  "good morning",
  "good afternoon",
  "good evening",
  "good day",
  "kumusta",
  "kamusta",
  "musta",
]);

const THANKS = new Set([
  "thanks",
  "thank you",
  "thankyou",
  "thank u",
  "thx",
  "ty",
  "salamat",
  "maraming salamat",
  "ok thanks",
  "okay thanks",
]);

export type SmallTalk = "greeting" | "thanks";

/** `"greeting"`, `"thanks"`, or null when the message is a real question. */
export function detectSmallTalk(query: string): SmallTalk | null {
  const normalized = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) return null;
  if (GREETINGS.has(normalized)) return "greeting";
  if (THANKS.has(normalized)) return "thanks";
  return null;
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
  context: HelpContext,
  phraseOnly: boolean
): number {
  const { title, titleWords, bodyWords, keywords } = indexOf(topic);

  /** Title and keyword hits — the person used this topic's own vocabulary. */
  let strong = 0;
  /** Body hits. Corroborating only; see the floor below. */
  let weak = 0;

  // Skipped on the phrase-only path: a query of nothing but stop words ("how do
  // i") is a substring of half the titles here, and would answer at random.
  if (!phraseOnly && normalizedQuery.length > 2 && title.includes(normalizedQuery)) {
    strong += 12;
  }
  if (normalizedQuery.length > 2 && keywords.some((k) => k === normalizedQuery)) {
    strong += 10;
  }

  for (const token of tokens) {
    if (keywords.some((k) => k === token)) {
      strong += 4;
    } else if (
      // Both directions, so "learners" reaches the keyword "learner" and vice
      // versa. Length-guarded on both sides: without it "add" matched
      // "address" and "log" matched "login".
      token.length >= 4 &&
      keywords.some(
        (k) => k.length >= 4 && (k.includes(token) || token.includes(k))
      )
    ) {
      strong += 2;
    }
    if (titleWords.has(token)) strong += 3;
    if (bodyWords.has(token)) weak += 1;
  }

  // The floor that keeps the assistant honest. Every topic's prose mentions
  // "school", "learner", "report" or "week" somewhere, so three incidental body
  // words used to clear MIN_SCORE and answer confidently: "who is my school
  // head" was answered with "A learner left. Do I delete them?". Body text
  // corroborates a title or keyword hit; on its own it is not evidence.
  if (strong === 0) return Math.min(weak, MIN_SCORE - 1);

  let score = strong + weak;

  // A tie between a general topic and one about the page in view goes to the
  // page in view. Small on purpose: a boost large enough to promote an
  // irrelevant topic would make the assistant answer the wrong question
  // confidently just because of where it was opened.
  if (matchesRoute(topic, context.pathname)) score += 2;

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
  // Small talk is answered by the panel in words, not with topics. Returning
  // matches for "hi" is how the assistant used to open with three unrelated
  // articles.
  if (detectSmallTalk(query)) return [];

  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  const tokens = tokenize(query);

  // A question can be entirely stop words and still be a real question:
  // "what can you do" tokenizes to nothing, which used to mean the topic named
  // "What can this assistant do?" could never answer it. On this path only an
  // exact keyword match counts, which is narrow enough not to guess.
  const phraseOnly = tokens.length === 0;
  if (phraseOnly && normalizedQuery.length < 3) return [];

  const ranked = HELP_TOPICS.filter((topic) => isVisibleTo(topic, context.role))
    .map((topic) => ({
      topic,
      score: scoreTopic(topic, tokens, normalizedQuery, context, phraseOnly),
    }))
    .filter((match) => match.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id));

  if (ranked.length === 0) return [];

  // Runners-up have to be in the same league as the winner. "how do i change
  // reading level" answered correctly and then offered "How do I change my
  // password?" underneath, which makes a right answer look like a guess.
  const [best] = ranked;
  return ranked.filter((match) => match.score * 2 >= best.score).slice(0, limit);
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
