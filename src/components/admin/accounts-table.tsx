"use client";

import { KeyRound } from "lucide-react";
import {
  AccountRowActions,
  PasswordCell,
} from "@/components/admin/account-row-actions";
import { EmptyState } from "@/components/dashboard/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { ListBusyRegion, TableSectionSkeleton } from "@/components/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
  NoValue,
  RowActions,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import {
  ListFilterBar,
  describeActiveFilters,
  type ListFilterField,
} from "@/components/admin/management/list-filter-bar";
import { ListPager, PageOutOfRangeState } from "@/components/admin/management/list-pager";
import type { SortOption } from "@/lib/sort/registry";
import type { AccountListSort, AccountRow } from "@/lib/admin/accounts";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import type { UserRole } from "@prisma/client";

/** The roles that have their own accounts page; each page lists exactly one. */
export type ManagedAccountRole = Extract<
  UserRole,
  "TEACHER" | "SCHOOL_HEAD" | "DISTRICT_ADMIN" | "SUPER_ADMIN"
>;

const ROLE_COPY: Record<
  ManagedAccountRole,
  {
    plural: string;
    /** What the place column shows for this role, or null for no column. */
    place: "school" | "districts" | null;
    emptyDescription: string;
    emptyAction?: { href: string; label: string };
  }
> = {
  TEACHER: {
    plural: "Teachers",
    place: "school",
    emptyDescription: "Teachers appear here once they register at a school.",
  },
  SCHOOL_HEAD: {
    plural: "School Heads",
    place: "school",
    emptyDescription: "A School Head account is created with its school.",
    emptyAction: { href: ADMIN_ROUTES.newSchool, label: "Create a school" },
  },
  DISTRICT_ADMIN: {
    plural: "District admins",
    place: "districts",
    emptyDescription: "District admin accounts appear here once they are set up.",
  },
  SUPER_ADMIN: {
    plural: "Admin accounts",
    place: null,
    emptyDescription: "Division and Developer Admin accounts appear here once they are set up.",
  },
};

export type AccountsTableList = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  q: string;
  /**
   * "Sort by" for this table. `AccountListSort` and the option list live in
   * `@/lib/admin/accounts`, a `server-only` module; both are imported here as
   * types only, so the option data is threaded in as a prop by the server page
   * rather than imported at runtime from a Client Component.
   */
  sort?: AccountListSort;
  sortOptions?: readonly SortOption<AccountListSort>[];
};

function SignInCell({ row }: { row: AccountRow }) {
  if (row.signIn.kind === "username")
    return <span className="text-sm">{row.signIn.value}</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="break-all text-sm">{row.signIn.value}</span>
      {row.signIn.synthetic ? (
        <Badge variant="outline">No mailbox</Badge>
      ) : null}
    </div>
  );
}

function StatusCell({ row }: { row: AccountRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge
        variant="outline"
        className={
          row.isActive
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
            : "border-border bg-muted text-muted-foreground"
        }
      >
        <span
          className={
            row.isActive
              ? "mr-1 size-1.5 rounded-full bg-emerald-500"
              : "mr-1 size-1.5 rounded-full bg-muted-foreground"
          }
        />
        {row.isActive ? "Active" : "Inactive"}
      </Badge>
      {row.approvalStatus === "PENDING" ? (
        <Badge
          variant="outline"
          className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        >
          Pending
        </Badge>
      ) : null}
      {row.approvalStatus === "REJECTED" ? (
        <Badge
          variant="outline"
          className="border-destructive/30 bg-destructive/10 text-destructive"
        >
          Declined
        </Badge>
      ) : null}
      {row.mustChangePassword ? (
        <span className="text-xs text-muted-foreground">
          Must change password
        </span>
      ) : null}
    </div>
  );
}

function placeText(row: AccountRow, place: "school" | "districts"): string {
  if (place === "districts") {
    const districts = row.districtAdminDistricts ?? [];
    return districts.length > 0 ? districts.join(", ") : "No district assigned";
  }
  return row.school ? `${row.school.name} · ${row.school.schoolIdCode}` : "—";
}

export type AccountsTableProps = {
  rows: AccountRow[];
  list: AccountsTableList;
  /** The one role this page lists; there is no role picker. */
  role: ManagedAccountRole;
  /** The page's own route, so filters, sort and paging stay on it. */
  basePath: string;
  /** Contextual filters the page offers for this role (district, school, …). */
  filters: ListFilterField[];
};

/**
 * Thin wrapper so `useListNavigate`/`useListPending` inside the filter bar,
 * the busy region and the pager resolve to THIS table's own
 * `ListNavigationProvider` — a hook sees only ancestor context.
 */
export function AccountsTable(props: AccountsTableProps) {
  return (
    <ListNavigationProvider>
      <AccountsTableInner {...props} />
    </ListNavigationProvider>
  );
}

function AccountsTableInner({ rows, list, role, basePath, filters }: AccountsTableProps) {
  const copy = ROLE_COPY[role];
  const plural = copy.plural.toLowerCase();
  const active = describeActiveFilters(filters, list.q);
  const place = copy.place;
  const placeLabel = place === "districts" ? "Districts" : "School";

  return (
    <div className="space-y-4">
      <Surface as="section" aria-label={`Find ${plural}`} className="rounded-lg p-3 sm:p-4">
        <ListFilterBar
          basePath={basePath}
          q={list.q}
          resultCount={list.totalCount}
          searchLabel={`Search ${plural}`}
          searchPlaceholder={
            place === "school" ? "Name, email, or school…" : "Name, username, or email…"
          }
          fields={filters}
          sort={
            list.sort && list.sortOptions
              ? { value: list.sort, options: list.sortOptions }
              : undefined
          }
        />
      </Surface>
      <Surface as="section" className="min-w-0 space-y-3 overflow-hidden rounded-lg">
        <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
          <h2 className="text-base font-semibold">
            {copy.plural}{" "}
            <span className="text-muted-foreground">
              ({list.totalCount.toLocaleString()})
            </span>
          </h2>
          <span className="text-xs text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
        </div>
        <ListBusyRegion
          label={plural}
          skeleton={<TableSectionSkeleton rows={10} columns={6} showToolbar={false} />}
        >
          {rows.length === 0 ? (
            <div className="px-4 pb-4">
              {list.totalCount > 0 ? (
                <PageOutOfRangeState
                  basePath={basePath}
                  page={list.page}
                  totalPages={list.totalPages}
                  totalCount={list.totalCount}
                  noun={plural}
                />
              ) : active.length > 0 ? (
                <EmptyState
                  title={`No ${plural} match`}
                  description={`Nothing matches ${active.join(" · ")}. Try a wider filter or clear them.`}
                  actionHref={basePath}
                  actionLabel="Clear filters"
                  icon={KeyRound}
                />
              ) : (
                <EmptyState
                  title={`No ${plural} yet`}
                  description={copy.emptyDescription}
                  actionHref={copy.emptyAction?.href}
                  actionLabel={copy.emptyAction?.label}
                  icon={KeyRound}
                />
              )}
            </div>
          ) : (
            <ResponsiveTable
              // Wide roster: the full table needs ~1300px of its own width.
              breakpoint={1300}
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Name</TableHead>
                      {place ? <TableHead>{placeLabel}</TableHead> : null}
                      <TableHead>Email / sign-in</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Password</TableHead>
                      <TableHead className="pr-4">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="max-w-[18rem] pl-4">
                          <div className="flex min-w-0 items-center gap-2">
                            <UserAvatar
                              name={row.fullName}
                              avatarPath={row.avatarPath}
                              size={32}
                              variant="thumb"
                            />
                            <CellText className="font-medium">{row.listingName}</CellText>
                          </div>
                        </TableCell>
                        {place === "school" ? (
                          <TableCell className="max-w-[16rem] text-muted-foreground">
                            {row.school ? (
                              <div className="flex min-w-0 flex-col">
                                <CellText>{row.school.name}</CellText>
                                <span className="text-xs tabular-nums">{row.school.schoolIdCode}</span>
                              </div>
                            ) : (
                              <NoValue />
                            )}
                          </TableCell>
                        ) : place === "districts" ? (
                          <TableCell className="max-w-[16rem] text-muted-foreground">
                            <CellText>{placeText(row, place)}</CellText>
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <SignInCell row={row} />
                        </TableCell>
                        <TableCell>
                          <StatusCell row={row} />
                        </TableCell>
                        <TableCell>
                          <PasswordCell row={row} />
                        </TableCell>
                        <TableCell className="pr-4">
                          <RowActions>
                            <AccountRowActions row={row} />
                          </RowActions>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label={plural}>
                  {rows.map((row) => (
                    <StackedRow
                      key={row.id}
                      leading={
                        <UserAvatar
                          name={row.fullName}
                          avatarPath={row.avatarPath}
                          size={32}
                          variant="thumb"
                        />
                      }
                      title={row.listingName}
                      state={<StatusCell row={row} />}
                      meta={
                        place ? <span className="truncate">{placeText(row, place)}</span> : undefined
                      }
                      details={[
                        { label: "Sign-in", value: <SignInCell row={row} /> },
                        { label: "Password", value: <PasswordCell row={row} /> },
                      ]}
                      // Three labelled buttons crushed the name to one letter on
                      // a phone, so they live in the expanded panel instead.
                      detailActions={<AccountRowActions row={row} align="start" />}
                    />
                  ))}
                </StackedList>
              }
            />
          )}
        </ListBusyRegion>
        {list.totalCount > 0 ? (
          <ListPager
            basePath={basePath}
            page={list.page}
            pageSize={list.pageSize}
            totalPages={list.totalPages}
            totalCount={list.totalCount}
            noun={plural}
          />
        ) : null}
      </Surface>
    </div>
  );
}
