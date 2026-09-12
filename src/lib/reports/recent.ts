import "server-only";

import { prisma } from "@/lib/prisma";
import type { RecentReportRow } from "@/components/reports/reports-hub";
import type { ReportFilters } from "@/lib/reports/kinds";

/** How many history rows the hub's table shows before "View all reports". */
export const RECENT_REPORTS_TAKE = 8;

/**
 * The Recent Reports table's rows.
 *
 * Scoped to one school AND one author: a report is "yours" in the design's own
 * words ("Your recently generated reports"), and a teacher has no business
 * reading which learners a colleague pulled a report over.
 */
export async function loadRecentReports(args: {
  schoolId: string;
  createdById: string;
}): Promise<RecentReportRow[]> {
  const rows = await prisma.report.findMany({
    where: {
      schoolId: args.schoolId,
      createdById: args.createdById,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      kind: true,
      format: true,
      scopeLabel: true,
      createdAt: true,
      filters: true,
      createdBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: RECENT_REPORTS_TAKE,
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    format: r.format,
    scopeLabel: r.scopeLabel,
    // Serialized for the client boundary; the component formats it locally.
    createdAt: r.createdAt.toISOString(),
    createdByName: r.createdBy.fullName,
    // `filters` is Json in the schema, so it arrives as JsonValue. It is only
    // ever written by `generateReport` from a Zod-parsed object, and it is
    // replayed through that same schema on Re-generate, so a malformed value
    // is rejected there rather than trusted here.
    filters: (r.filters ?? {}) as ReportFilters,
  }));
}
