import type { AttentionItem } from "@/lib/dashboard/school-head-overview";
import type { SummaryList } from "@/lib/summary/types";
import type { ShellNotification } from "@/components/shell/notifications-menu";
import { sectionAnchorId } from "@/components/summary/summary-href";

/** Flag lists shown before the rest collapse into one "more" row. */
export const ATTENTION_LIST_LIMIT = 3;

function schoolWord(count: number): string {
  return count === 1 ? "1 school" : `${count} schools`;
}

/** "Alabel CES, Glan ES and 3 more" from a list's first column. */
export function previewSchools(rows: SummaryList["rows"], shown = 2): string {
  const names = rows
    .map((row) => (row[0] === null || row[0] === undefined ? "" : String(row[0])))
    .filter((name) => name.length > 0);
  const head = names.slice(0, shown);
  const rest = names.length - head.length;
  if (head.length === 0) return schoolWord(rows.length);
  if (rest === 0) {
    return head.length === 1 ? head[0]! : `${head.slice(0, -1).join(", ")} and ${head[head.length - 1]}`;
  }
  return `${head.join(", ")} and ${rest} more`;
}

function ticketTone(tone: ShellNotification["tone"]): AttentionItem["tone"] {
  if (tone === "amber") return "amber";
  if (tone === "violet") return "primary";
  return "muted";
}

/**
 * The district overview's "Needs your attention" rows: open support requests
 * first (the header bell's own alert, so the two never disagree), then the
 * non-compliance lists with the most schools in them. Typed on the School
 * Head's `AttentionItem` so the same panel renders both.
 */
export function buildDistrictAttention({
  notifications,
  complianceLists,
  complianceHref,
  limit = ATTENTION_LIST_LIMIT,
}: {
  notifications: readonly ShellNotification[];
  complianceLists: readonly SummaryList[];
  /** The compliance summary page; list rows deep-link to their anchor on it. */
  complianceHref: string;
  limit?: number;
}): AttentionItem[] {
  const tickets: AttentionItem[] = notifications.map((n) => ({
    id: n.id,
    label: n.title,
    detail: n.description,
    href: n.href,
    badge: null,
    tone: ticketTone(n.tone),
  }));

  const flagged = complianceLists
    .filter((list) => list.rows.length > 0)
    .map((list, index) => ({ list, index }))
    // Biggest lists first; ties keep the facet's own flag order.
    .sort((a, b) => b.list.rows.length - a.list.rows.length || a.index - b.index)
    .map(({ list }) => list);

  const shown: AttentionItem[] = flagged.slice(0, limit).map((list) => ({
    id: `compliance-${list.id}`,
    label: list.title,
    detail: previewSchools(list.rows),
    href: `${complianceHref}#${sectionAnchorId(`list-${list.id}`)}`,
    badge: schoolWord(list.rows.length),
    tone: "amber",
  }));

  const hidden = flagged.length - shown.length;
  if (hidden > 0) {
    shown.push({
      id: "compliance-more",
      label: hidden === 1 ? "1 more compliance flag" : `${hidden} more compliance flags`,
      detail: "See every flagged school",
      href: complianceHref,
      badge: null,
      tone: "muted",
    });
  }

  const items = [...tickets, ...shown];
  if (items.length > 0) return items;

  return [
    {
      id: "all-clear",
      label: "Nothing needs your attention",
      detail: "No open support requests and no flagged schools.",
      // Empty href: the panel renders this row as plain text, not a link.
      href: "",
      badge: null,
      tone: "muted",
    },
  ];
}
