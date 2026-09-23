import { Suspense } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";
import { ScrollText } from "lucide-react";
import { addDays, parseLocalDateKey } from "@/lib/date-keys";
import {
  parseAuditListParams,
  type AuditListParams,
} from "@/lib/validators/audit-list.schema";
import { totalPages } from "@/lib/learners/pagination";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { AuditFilters } from "@/components/school-head/audit-filters";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { ListBusyRegion } from "@/components/loading";
import { listKey } from "@/lib/nav/list-params";

export const dynamic = "force-dynamic";

const AUDIT_PAGE_SIZE = 50;

/**
 * Every param `parseAuditListParams` reads — the complete set that changes
 * which audit rows are shown. `schoolId` (Super Admin's view context) is
 * deliberately excluded, same reasoning as the Teachers and ARAL boundaries.
 */
export const AUDIT_LIST_KEYS = ["page", "q", "from", "to"] as const;

interface PageProps {
  searchParams: Promise<{
    schoolId?: string;
    q?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

/**
 * Builds the audit `where` clause. `schoolId` is a top-level field ANDed with
 * everything else, never folded into an `OR` — the single hard rule for this
 * page is that a search term can narrow inside a school, never reach outside
 * it.
 *
 * `AuditLog.userId` carries no `@relation` to `User` (see the comment beside
 * `advisorySectionId` in `schema.prisma`: a back-reference there would make
 * `User`/`Section` a write-order cycle, and `AuditLog.userId` was given the
 * same plain-column treatment for the same reason). So actor-name search
 * can't join through Prisma — it resolves matching users in THIS school
 * first, then narrows the audit rows by that id list. Because the user
 * lookup is already `schoolId`-scoped, the id list itself can never contain
 * another tenant's account, so the audit query's tenancy can't be widened by
 * this indirection.
 */
async function auditWhere(
  schoolId: string,
  list: AuditListParams
): Promise<Prisma.AuditLogWhereInput> {
  const gte = list.from ? parseLocalDateKey(list.from) : undefined;
  const lt = list.to ? addDays(parseLocalDateKey(list.to), 1) : undefined;

  const where: Prisma.AuditLogWhereInput = {
    schoolId,
    ...(gte || lt
      ? { timestamp: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } }
      : {}),
  };

  if (list.q) {
    const actors = await prisma.user.findMany({
      where: { schoolId, fullName: { contains: list.q, mode: "insensitive" } },
      select: { id: true },
    });
    const actorIds = actors.map((a) => a.id);
    where.AND = [
      {
        OR: [
          { userId: { in: actorIds } },
          { action: { contains: list.q, mode: "insensitive" } },
        ],
      },
    ];
  }

  return where;
}

async function SchoolAuditTable({
  schoolId,
  schoolIdParam,
  list,
}: {
  schoolId: string;
  schoolIdParam?: string;
  list: AuditListParams;
}) {
  const where = await auditWhere(schoolId, list);
  const totalCount = await prisma.auditLog.count({ where });
  const pages = totalPages(totalCount, AUDIT_PAGE_SIZE);
  const page = Math.min(list.page, pages);

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: "desc" },
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
  });

  const hasFilters = Boolean(list.q || list.from || list.to);
  const filterParams: Record<string, string | undefined> = {
    schoolId: schoolIdParam,
    q: list.q || undefined,
    from: list.from ?? undefined,
    to: list.to ?? undefined,
  };

  return (
    <ListNavigationProvider>
      <Surface as="section">
        <SurfaceHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="whitespace-nowrap text-base font-semibold">
            {totalCount} event{totalCount === 1 ? "" : "s"}
          </h2>
          <AuditFilters
            basePath={SCHOOL_HEAD_ROUTES.audit}
            state={{ q: list.q, from: list.from, to: list.to }}
            otherParams={{ schoolId: schoolIdParam }}
          />
        </SurfaceHeader>
        {logs.length === 0 ? (
          <SurfaceBody>
            <EmptyState
              title={hasFilters ? "No events match your filters" : "Nothing audited yet"}
              description={
                hasFilters
                  ? "Try a different search term or widen the date range."
                  : "Changes made in this school will be recorded here."
              }
              icon={ScrollText}
            />
          </SurfaceBody>
        ) : (
          <>
            {/* The table is wider than a phone. It scrolls in its own container so the
                page body never scrolls sideways. */}
            <ListBusyRegion
              label="audit entries"
              skeleton={
                <div className="p-2">
                  <TableSectionSkeleton
                    rows={Math.min(logs.length || 10, 10)}
                    columns={4}
                    showToolbar={false}
                  />
                </div>
              }
            >
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When (UTC)</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {log.timestamp
                            .toISOString()
                            .replace("T", " ")
                            .slice(0, 19)}
                        </TableCell>
                        <TableCell className="font-medium">{log.action}</TableCell>
                        <TableCell>{log.resource}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {log.resourceId ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Below lg: one stacked row per event, as in the learner roster's
                  phone list (src/components/learners/learner-list-client.tsx). */}
              <ul className="divide-y divide-border/60 lg:hidden" aria-label="Audit events">
                {logs.map((log) => (
                  <li key={log.id} className="flex flex-col gap-1 px-3 py-3 sm:px-4">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium text-foreground">{log.action}</span>
                      <span className="text-sm text-muted-foreground">{log.resource}</span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">
                        {log.timestamp
                          .toISOString()
                          .replace("T", " ")
                          .slice(0, 19)}
                      </span>
                      <span className="min-w-0 break-all font-mono">
                        {log.resourceId ?? "—"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </ListBusyRegion>
            <LearnerPagination
              basePath={SCHOOL_HEAD_ROUTES.audit}
              page={page}
              totalPages={pages}
              searchParams={filterParams}
            />
          </>
        )}
      </Surface>
    </ListNavigationProvider>
  );
}

export default async function SchoolAuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.audit
  );
  const list = parseAuditListParams(params);

  return (
    <SchoolHeadPage
      title="Audit history"
      description="The most recent audited actions in your school."
      view={view}
    >
      <Suspense
        key={listKey(params, AUDIT_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={10} columns={4} />}
      >
        <SchoolAuditTable
          schoolId={view.schoolId}
          schoolIdParam={params.schoolId}
          list={list}
        />
      </Suspense>
    </SchoolHeadPage>
  );
}
