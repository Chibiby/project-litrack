import { formatLocalDateKey } from "@/lib/date-keys";

/**
 * Pure helpers the messenger-style chat renders from. No React, no Prisma, so
 * the server actions and the components agree on one set of rules.
 */

/** The six fixed reactions, in the order the reaction bar shows them. */
export const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

/** Spoken names for screen readers: "React with thumbs up". */
export const REACTION_LABELS: Record<ReactionEmoji, string> = {
  "👍": "thumbs up",
  "❤️": "heart",
  "😂": "laugh",
  "😮": "wow",
  "😢": "sad",
  "🙏": "thank you",
};

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJI as readonly string[]).includes(value);
}

/** Consecutive messages from one person within this gap read as one turn. */
export const GROUP_WINDOW_MS = 5 * 60_000;

/** How long after sending the author may still change the text. */
export const EDIT_WINDOW_MS = 15 * 60_000;

export type MessageGroup<T> = { authorId: string; dayKey: string; items: T[] };

/** Messages (oldest first) folded into sender turns, split by author, day and gap. */
export function groupMessages<T extends { id: string; authorId: string; createdAt: Date }>(
  rows: T[]
): MessageGroup<T>[] {
  const groups: MessageGroup<T>[] = [];
  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    const dayKey = formatLocalDateKey(createdAt);
    const last = groups.at(-1);
    const previous = last?.items.at(-1);
    const continues =
      last &&
      previous &&
      last.authorId === row.authorId &&
      last.dayKey === dayKey &&
      createdAt.getTime() - new Date(previous.createdAt).getTime() <= GROUP_WINDOW_MS;
    if (continues) last.items.push(row);
    else groups.push({ authorId: row.authorId, dayKey, items: [row] });
  }
  return groups;
}

export function canEditMessage(
  message: { authorId: string; createdAt: Date; deletedAt: Date | null },
  viewerId: string,
  now: Date = new Date()
): boolean {
  if (message.deletedAt) return false;
  if (message.authorId !== viewerId) return false;
  return now.getTime() - new Date(message.createdAt).getTime() <= EDIT_WINDOW_MS;
}

export function typingLabel(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

function clockLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

/**
 * The line under your newest message. The staff room names who has seen it;
 * the private admin line has one reader that matters, so it gives the time.
 */
export function seenLabel(
  kind: "SCHOOL" | "ADMIN_DIRECT",
  readers: { name: string; readAt: Date }[]
): string | null {
  if (readers.length === 0) return null;
  if (kind === "ADMIN_DIRECT") {
    const latest = readers.reduce((a, b) =>
      new Date(b.readAt).getTime() > new Date(a.readAt).getTime() ? b : a
    );
    return `Seen ${clockLabel(new Date(latest.readAt))}`;
  }
  const shown = readers.slice(0, 2).map((r) => r.name).join(", ");
  const extra = readers.length - 2;
  return extra > 0 ? `Seen by ${shown} +${extra}` : `Seen by ${shown}`;
}

const PREVIEW_MAX = 80;

/** One-line preview for a conversation list: "You: …", "Ana: …", "Message removed". */
export function previewLine(
  message: { body: string; deletedAt: Date | null; authorId: string; authorFirstName: string },
  viewerId: string
): string {
  if (message.deletedAt) return "Message removed";
  const firstLine = message.body.split(/\r?\n/)[0]?.trim() ?? "";
  const text = firstLine.length > PREVIEW_MAX ? `${firstLine.slice(0, PREVIEW_MAX)}…` : firstLine;
  const who = message.authorId === viewerId ? "You" : message.authorFirstName;
  return `${who}: ${text}`;
}
