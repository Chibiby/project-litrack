import type { ShellNotification } from "@/components/shell/notifications-menu";

/**
 * Derives shell alerts from already-loaded dashboard numbers. Nothing is
 * persisted — there is no Notification model and this pass adds none.
 */
export function buildTeacherNotifications(input: {
  pendingAralProfiling: number;
  attendanceMissingThisWeek: number;
  readingPending: number;
  aralHref: string;
  attendanceHref: string;
  readingHref: string;
}): ShellNotification[] {
  const out: ShellNotification[] = [];

  if (input.pendingAralProfiling > 0) {
    out.push({
      id: "aral-profiling",
      title: `${input.pendingAralProfiling} ARAL profile${
        input.pendingAralProfiling === 1 ? "" : "s"
      } incomplete`,
      description: "Finish Sections B–E to unlock reporting.",
      href: input.aralHref,
      tone: "violet",
    });
  }

  if (input.attendanceMissingThisWeek > 0) {
    out.push({
      id: "attendance-week",
      title: "Weekly attendance incomplete",
      description: `${input.attendanceMissingThisWeek} session${
        input.attendanceMissingThisWeek === 1 ? "" : "s"
      } still unmarked this week.`,
      href: input.attendanceHref,
      tone: "amber",
    });
  }

  if (input.readingPending > 0) {
    out.push({
      id: "reading-month",
      title: "Monthly reading level pending",
      description: `${input.readingPending} learner${
        input.readingPending === 1 ? "" : "s"
      } not yet assessed this month.`,
      href: input.readingHref,
      tone: "amber",
    });
  }

  return out;
}
