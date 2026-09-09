/**
 * @mention parsing.
 *
 * A pure function over the message text, with no imports, so the rule that
 * decides who gets notified is one testable thing rather than a regex buried in
 * a server action.
 *
 * Handles are usernames, not display names. Two people in a school can share a
 * display name and neither of them can be notified reliably by it; usernames are
 * already unique and already how these accounts are addressed at sign-in.
 * Resolution to a real account happens in the action, against the channel's own
 * members — this function only says which handles were typed.
 */

/**
 * Usernames in this app are lowercase and may carry dots and dashes
 * (`teacher.cruz.1a2b`), so a handle runs until whitespace or punctuation that
 * cannot appear inside one. A trailing dot is excluded deliberately: "ask
 * @john." ends a sentence, and the mention is `john`.
 */
const MENTION_RE = /@([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)/gi;

/** Longest handle worth looking up. Anything longer is not a username here. */
const MAX_HANDLE = 64;

/**
 * The distinct handles mentioned in `body`, lowercased, in the order typed.
 *
 * Order matters only for stable test output and for showing "you and 2 others"
 * consistently; nothing downstream depends on it.
 */
export function parseMentionHandles(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const match of body.matchAll(MENTION_RE)) {
    const handle = match[1]?.toLowerCase();
    if (!handle || handle.length > MAX_HANDLE) continue;
    if (seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }

  return out;
}

/** A person a mention can resolve to, as the renderer needs them. */
export type MentionTarget = {
  id: string;
  username: string | null;
  /** What the reader sees in place of the handle, e.g. "Teacher Marivic". */
  displayName: string;
};

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; userId: string };

/**
 * Split a body into text and resolved mentions, for rendering.
 *
 * An unresolved handle stays plain text rather than becoming a dead chip: an
 * email address, a price, or a mention of somebody who has since left the school
 * should read as what the author typed, not as a broken link.
 */
export function segmentMessage(
  body: string,
  targets: MentionTarget[]
): MessageSegment[] {
  const byHandle = new Map<string, MentionTarget>();
  for (const target of targets) {
    if (target.username) byHandle.set(target.username.toLowerCase(), target);
  }

  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const match of body.matchAll(MENTION_RE)) {
    const handle = match[1]?.toLowerCase();
    const target = handle ? byHandle.get(handle) : undefined;
    if (!target || match.index === undefined) continue;

    if (match.index > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, match.index) });
    }
    segments.push({
      kind: "mention",
      text: `@${target.displayName}`,
      userId: target.id,
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }

  return segments;
}
