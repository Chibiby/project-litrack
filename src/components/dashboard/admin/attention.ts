import type { AttentionItem } from "@/lib/dashboard/school-head-overview";

/** The subset of `getAdminMetricCounts()` the attention rail reads. */
export type AdminAttentionCounts = {
  schoolsTotal: number;
  schoolsInactive: number;
  pendingTeacherApprovals: number;
};

export const ADMIN_ATTENTION_HREFS = {
  newSchool: "/admin/schools/new",
  inactiveSchools: "/admin/schools?status=inactive",
  teacherAccounts: "/admin/accounts?role=TEACHER",
} as const;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The Super Admin dashboard's "Needs your attention" rows, in the
 * `AttentionItem` shape `SchoolAttentionPanel` already renders. `null` counts
 * mean the figures failed to load: say so rather than claiming "all clear".
 */
export function buildAdminAttention(
  counts: AdminAttentionCounts | null
): AttentionItem[] {
  if (!counts) {
    return [
      {
        id: "unavailable",
        label: "Figures unavailable",
        detail: "The dashboard counts could not be loaded. Reload to try again.",
        href: "",
        badge: null,
        tone: "muted",
      },
    ];
  }

  const items: AttentionItem[] = [];

  if (counts.schoolsTotal === 0) {
    items.push({
      id: "no-schools",
      label: "Add your first school",
      detail: "No schools are registered yet",
      href: ADMIN_ATTENTION_HREFS.newSchool,
      badge: null,
      tone: "primary",
    });
  }

  if (counts.schoolsInactive > 0) {
    items.push({
      id: "inactive-schools",
      label: "Inactive schools",
      detail: `${plural(counts.schoolsInactive, "school is", "schools are")} switched off`,
      href: ADMIN_ATTENTION_HREFS.inactiveSchools,
      badge: String(counts.schoolsInactive),
      tone: "amber",
    });
  }

  if (counts.pendingTeacherApprovals > 0) {
    items.push({
      id: "pending-teachers",
      label: "Teacher registrations waiting",
      detail: "Awaiting their School Head's approval",
      href: ADMIN_ATTENTION_HREFS.teacherAccounts,
      badge: String(counts.pendingTeacherApprovals),
      tone: "amber",
    });
  }

  if (items.length === 0) {
    items.push({
      id: "all-clear",
      label: "All clear",
      detail: "Nothing needs your attention right now",
      href: "",
      badge: null,
      tone: "muted",
    });
  }

  return items;
}

/** The hero's meta chip: how many schools, and how many are live. */
export function buildAdminMetaLabel(
  counts: Pick<AdminAttentionCounts, "schoolsTotal" | "schoolsInactive"> | null
): string | undefined {
  if (!counts) return undefined;
  if (counts.schoolsTotal === 0) return "No schools yet";
  const active = counts.schoolsTotal - counts.schoolsInactive;
  return `${plural(counts.schoolsTotal, "school", "schools")} · ${active} active · ${counts.schoolsInactive} inactive`;
}
