import type { UserRole } from "@prisma/client";
import {
  BookOpen,
  CalendarCheck,
  FileText,
  Inbox,
  KeyRound,
  LifeBuoy,
  School,
  Users,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

/**
 * The tiles the assistant offers before anything has been typed.
 *
 * Plain data, like `./topics` — no server imports, so the whole set ships to the
 * browser and a tile answers in the same frame it is pressed.
 *
 * Each tile is one of two things: a shortcut to a curated topic, or the entry
 * to the ticket form. Nothing here performs an action on the person's behalf;
 * a tile either answers or hands off, which is why a stale tile can never do
 * something surprising.
 */

export type QuickAction = {
  id: string;
  /** Two short words, because the tile is a 3-column grid cell. */
  label: string;
  icon: LucideIcon;
  /** Tint for the icon square. Kept beside the label so the grid stays legible. */
  tint: string;
  /** `topic` answers from the index; `ticket` opens the request form. */
  kind: "topic" | "ticket";
  /** The `HELP_TOPICS` id to answer with. Required when `kind` is `topic`. */
  topicId?: string;
  /** Roles this tile is offered to. Omitted means every role. */
  roles?: UserRole[];
};

/**
 * Role visibility here is an EXACT match, deliberately unlike `search.ts`.
 *
 * A Super Admin passes every role check elsewhere by impersonation, and the help
 * index follows that rule so an admin looking at a teacher's page can read the
 * teacher's help. Tiles are different: they are the assistant's own front page,
 * not a page being viewed, and an admin does not file the tickets they answer.
 * Folding the impersonation rule in here would put "Request Access" in front of
 * the only person who cannot use it.
 */
function visibleTo(action: QuickAction, role: UserRole): boolean {
  return !action.roles || action.roles.includes(role);
}

const ACTIONS: QuickAction[] = [
  {
    id: "learners",
    label: "Check Learner Info",
    icon: Users,
    tint: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
    kind: "topic",
    topicId: "learner-find",
    roles: ["TEACHER", "SCHOOL_HEAD"],
  },
  {
    id: "attendance",
    label: "Attendance Summary",
    icon: CalendarCheck,
    tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    kind: "topic",
    topicId: "attendance-summary",
    roles: ["TEACHER"],
  },
  {
    id: "reports",
    label: "Generate Reports",
    icon: FileText,
    tint: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    kind: "topic",
    topicId: "reports-generate",
  },
  {
    id: "reading-level",
    label: "Reading Level Insights",
    icon: BookOpen,
    tint: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
    kind: "topic",
    topicId: "reading-level-monthly",
    roles: ["TEACHER"],
  },
  {
    id: "approve-teachers",
    label: "Approve Teachers",
    icon: UserCheck,
    tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    kind: "topic",
    topicId: "sh-approve-teachers",
    roles: ["SCHOOL_HEAD"],
  },
  {
    id: "school-year",
    label: "School Year Setup",
    icon: School,
    tint: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
    kind: "topic",
    topicId: "sh-school-year",
    roles: ["SCHOOL_HEAD"],
  },
  {
    id: "support-inbox",
    label: "Support Inbox",
    icon: Inbox,
    tint: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
    kind: "topic",
    topicId: "admin-support-inbox",
    roles: ["SUPER_ADMIN"],
  },
  {
    id: "school-view",
    label: "Viewing A School",
    icon: School,
    tint: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
    kind: "topic",
    topicId: "admin-school-view",
    roles: ["SUPER_ADMIN"],
  },
  {
    id: "help",
    label: "Help & Guide",
    icon: LifeBuoy,
    tint: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    kind: "topic",
    topicId: "assistant-what-can-you-do",
  },
  {
    id: "request-access",
    label: "Request Access",
    icon: KeyRound,
    tint: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
    kind: "ticket",
    // Super Admin answers these requests rather than raising them, and
    // `submitTicket` refuses them outright: it takes `requireSchoolUser`, and an
    // admin holds no school to file against.
    roles: ["TEACHER", "SCHOOL_HEAD"],
  },
];

/** The tiles for one role, in grid order. Never more than six. */
export function getQuickActions(role: UserRole): QuickAction[] {
  return ACTIONS.filter((action) => visibleTo(action, role)).slice(0, 6);
}
