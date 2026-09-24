"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, ExternalLink, KeyRound, Copy, CheckCircle2, AlertTriangle, Search, ChevronLeft, ChevronRight, Eye, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteSchool, regenerateSchoolHeadCredential } from "@/lib/actions/school";
import { SchoolActiveToggle } from "@/components/admin/school-active-toggle";
import { ConfirmAction } from "@/components/confirm-action";
import { setSchoolActive } from "@/lib/actions/school-management";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { SortSelect } from "@/components/ui/sort-select";
import type { SortOption } from "@/lib/sort/registry";
import type { SchoolsListSort } from "@/lib/cache/schools-list";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";
import {
  ListNavigationProvider,
  LinkStatusPulse,
  useListNavigate,
  useListPending,
} from "@/components/nav/list-navigation";
import { ListBusyRegion, TableSectionSkeleton } from "@/components/loading";

export type SchoolRow = {
  id: string;
  name: string;
  schoolIdCode: string;
  region: string | null;
  division: string | null;
  isActive: boolean;
  users: number;
  learners: number;
  /**
   * The training tenant. Kept in this admin table even while it is hidden
   * from the login page and the dashboard counts — an admin has to be able to
   * see and manage the school whose visibility they are switching.
   */
  isDemo: boolean;
};

/**
 * A district admin's list comes from `resolveScopeSchools`, which carries the
 * district but no user/learner counts, so those two are optional here and the
 * district column set never renders them.
 */
export type SchoolsTableRow = Omit<SchoolRow, "users" | "learners"> & {
  users?: number;
  learners?: number;
  district?: string | null;
};

/**
 * What the viewer may do from this table. The server actions enforce the same
 * rules; hiding a control is only the courtesy of not offering it.
 */
export type SchoolsTableCapabilities = {
  toggleActive: boolean;
  resetHead: boolean;
  /** The row link leads to an edit form rather than a read-only view. */
  edit: boolean;
  delete: boolean;
  /** "Open as School Head" (`?schoolId=` impersonated view). */
  openAsSchoolHead: boolean;
  /** Region filter and the Region/Division/Users/Learners columns. */
  columns: "admin" | "district";
  basePath: string;
  emptyMessage: string;
};

// Not exported: a Server Component importing a value from this client module
// would receive a client reference, not the object.
const ADMIN_SCHOOLS_TABLE_CAPABILITIES: SchoolsTableCapabilities = {
  toggleActive: true,
  resetHead: true,
  edit: false,
  delete: true,
  openAsSchoolHead: true,
  columns: "admin",
  basePath: "/admin/schools",
  emptyMessage: "No schools found. Create your first school to get started.",
};

export type SchoolsTableList = {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  q: string;
  region: string;
  status: "" | "active" | "inactive";
  /**
   * "Sort by" for this table. Optional so `list` stays a safe superset for
   * any caller that does not wire it — mirrors `TeachersActiveTable`'s
   * `list.sort`/`list.sortOptions` pattern. `SchoolsListSort` and the option
   * list live in `@/lib/cache/schools-list`, a `server-only` module; both are
   * imported here as types only (erased at compile time by
   * `isolatedModules`), so the actual option data must be threaded in as a
   * prop by the server page rather than imported at runtime from a Client
   * Component.
   */
  sort?: SchoolsListSort;
  sortOptions?: readonly SortOption<SchoolsListSort>[];
};

const REGIONS = [
  { value: "NCR", label: "NCR - National Capital Region" },
  { value: "CAR", label: "CAR - Cordillera Administrative Region" },
  { value: "Region I", label: "Region I - Ilocos" },
  { value: "Region II", label: "Region II - Cagayan Valley" },
  { value: "Region III", label: "Region III - Central Luzon" },
  { value: "Region IV-A", label: "Region IV-A - Calabarzon" },
  { value: "Region IV-B", label: "Region IV-B - Mimaropa" },
  { value: "Region V", label: "Region V - Bicol" },
  { value: "Region VI", label: "Region VI - Western Visayas" },
  { value: "Region VII", label: "Region VII - Central Visayas" },
  { value: "Region VIII", label: "Region VIII - Eastern Visayas" },
  { value: "Region IX", label: "Region IX - Zamboanga Peninsula" },
  { value: "Region X", label: "Region X - Northern Mindanao" },
  { value: "Region XI", label: "Region XI - Davao" },
  { value: "Region XII", label: "Region XII - Soccsksargen" },
  { value: "Region XIII", label: "Region XIII - Caraga" },
  { value: "BARMM", label: "BARMM - Bangsamoro" },
];

function RegenButton({
  schoolId,
  schoolName,
  onCredential,
  className = "h-9 w-10",
}: {
  schoolId: string;
  schoolName: string;
  onCredential: (value: string) => void;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      // An icon button that happened to be drawn at `sm`'s box. `size="icon"` is
      // what makes the shared spinner *replace* the key glyph instead of sitting
      // beside it; h-9/w-10 keeps the exact footprint `size="sm"` gave it, so the
      // row of actions is unchanged when idle.
      size="icon"
      className={className}
      loading={pending}
      loadingText="Resetting password…"
      title="Reset School Head password to the School ID"
      aria-label={`Reset School Head password to the School ID for ${schoolName}`}
      onClick={() => {
        if (
          !window.confirm(
            `Reset the School Head password for ${schoolName} back to its School ID? Any password the School Head chose will stop working.`
          )
        ) {
          return;
        }
        const fd = new FormData();
        fd.set("schoolId", schoolId);
        startTransition(async () => {
          const res = await regenerateSchoolHeadCredential(fd);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          if (res.data?.password) {
            onCredential(res.data.password);
          }
        });
      }}
    >
      <KeyRound className="h-4 w-4" aria-hidden />
    </Button>
  );
}

function hrefFor(list: SchoolsTableList, page: number, basePath: string): string {
  const params = new URLSearchParams();
  if (list.q) params.set("q", list.q);
  if (list.region) params.set("region", list.region);
  if (list.status) params.set("status", list.status);
  if (list.sort) params.set("sort", list.sort);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function SchoolsPager({
  list,
  hrefFor: buildHref,
}: {
  list: SchoolsTableList;
  hrefFor: (list: SchoolsTableList, page: number) => string;
}) {
  const pending = useListPending();
  const canGoBack = list.page > 1;
  const canGoForward = list.page < list.totalPages;

  return (
    <div className="flex items-center justify-between gap-3">
      <Button
        asChild
        variant="outline"
        size="sm"
        className="rounded-lg"
        disabled={!canGoBack}
      >
        <Link
          href={buildHref(list, list.page - 1)}
          className={!canGoBack ? "pointer-events-none opacity-50" : ""}
          aria-disabled={!canGoBack || pending}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
          <LinkStatusPulse />
        </Link>
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {list.page} of {list.totalPages}
      </span>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="rounded-lg"
        disabled={!canGoForward}
      >
        <Link
          href={buildHref(list, list.page + 1)}
          className={!canGoForward ? "pointer-events-none opacity-50" : ""}
          aria-disabled={!canGoForward || pending}
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
          <LinkStatusPulse />
        </Link>
      </Button>
    </div>
  );
}

/**
 * Thin wrapper so `useListNavigate`/`useListPending` inside
 * `SchoolsTableInner` (and its `SchoolsPager`) resolve to THIS table's own
 * `ListNavigationProvider` rather than the no-provider fallback — a hook
 * call sees only ANCESTOR context, so it must live inside the provider's
 * subtree, not in the same component that renders the provider.
 */
export function SchoolsTable(props: {
  schools: SchoolsTableRow[];
  list: SchoolsTableList;
  /** Defaults to the Super Admin console's full set. */
  capabilities?: Partial<SchoolsTableCapabilities>;
}) {
  return (
    <ListNavigationProvider>
      <SchoolsTableInner {...props} />
    </ListNavigationProvider>
  );
}

function SchoolsTableInner({
  schools,
  list,
  capabilities,
}: {
  schools: SchoolsTableRow[];
  list: SchoolsTableList;
  capabilities?: Partial<SchoolsTableCapabilities>;
}) {
  const caps: SchoolsTableCapabilities = { ...ADMIN_SCHOOLS_TABLE_CAPABILITIES, ...capabilities };
  const { basePath } = caps;
  const isAdminColumns = caps.columns === "admin";
  const detailHref = (id: string) => `${basePath}/${id}`;
  const DetailIcon = caps.edit ? Pencil : Eye;
  const detailVerb = caps.edit ? "Edit" : "View";
  // The district list stays a card list through tablet widths, so its controls
  // keep a 40px target there; `size="sm"` drops to 36px from `sm` up.
  const mobileTouch = isAdminColumns ? undefined : "sm:h-10";
  const navigate = useListNavigate();
  const [credential, setCredential] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  /**
   * The school whose toggle is in flight. A single table-wide flag put *every*
   * row's toggle into its loading state at once, so changing one school read as
   * if the whole list were changing.
   */
  const [actingId, setActingId] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState(list.q);
  const [prevListQ, setPrevListQ] = useState(list.q);
  const [optimisticSchools, dispatchOptimistic] = useOptimistic(
    schools,
    (state: SchoolsTableRow[], op: ListOptimisticOp<SchoolsTableRow>) =>
      listOptimisticReducer(state, op)
  );

  if (list.q !== prevListQ) {
    setPrevListQ(list.q);
    setSearchValue(list.q);
  }

  const pushList = (next: { page?: number; q?: string; region?: string; status?: SchoolsTableList["status"] }) => {
    const params = new URLSearchParams();
    const q = next.q !== undefined ? next.q : list.q;
    const region = next.region !== undefined ? next.region : list.region;
    const status = next.status !== undefined ? next.status : list.status;
    const page = next.page !== undefined ? next.page : list.page;
    if (q) params.set("q", q);
    if (region) params.set("region", region);
    if (status) params.set("status", status);
    if (list.sort) params.set("sort", list.sort);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    navigate(qs ? `${basePath}?${qs}` : basePath);
  };

  const toggleActive = (school: SchoolsTableRow, nextActive: boolean) => {
    setActingId(school.id);
    // The rejection still travels to the toggle, which is what keeps its own
    // busy label alive until the action settles either way.
    return runOptimistic(startTransition, async () => {
      dispatchOptimistic({
        type: "patch",
        id: school.id,
        patch: { isActive: nextActive },
      });
      const fd = new FormData();
      fd.set("schoolId", school.id);
      fd.set("isActive", nextActive ? "true" : "false");
      const res = await setSchoolActive(fd);
      await settleActionResult(
        res,
        nextActive ? "School activated" : "School deactivated"
      );
    }).finally(() => setActingId(null));
  };

  const from =
    list.totalCount > 0 ? (list.page - 1) * list.pageSize + 1 : 0;
  const to = Math.min(list.page * list.pageSize, list.totalCount);

  return (
    <div className="space-y-4">
      {credential ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-start gap-2 text-amber-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Password reset to the School ID</p>
                <p className="text-sm text-amber-900/90">
                  The School Head can sign in now with their School ID below, and choose a private
                  password afterwards.
                </p>
              </div>
            </div>
            <div className="break-all rounded-lg border bg-card p-3 font-mono text-sm">
              {credential}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(credential);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button type="button" size="sm" onClick={() => setCredential(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search schools…"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                pushList({ page: 1, q: searchValue.trim() });
              }
            }}
            className="pl-9"
            aria-label="Search schools"
          />
        </div>

        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:items-center">
          {isAdminColumns ? (
            <Select
              value={list.region || "all"}
              onValueChange={(value) =>
                pushList({ page: 1, region: value === "all" ? "" : value })
              }
            >
              <SelectTrigger className="w-full sm:w-[160px]" aria-label="Filter by region">
                <SelectValue placeholder="Filter by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {REGIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select
            value={list.status || "all"}
            onValueChange={(value) =>
              pushList({ page: 1, status: value === "all" ? "" : (value as "active" | "inactive") })
            }
          >
            <SelectTrigger className="w-full sm:w-[140px]" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          {list.sort && list.sortOptions ? (
            <SortSelect
              mode="link"
              id="schools-sort"
              basePath={basePath}
              value={list.sort}
              options={list.sortOptions}
              searchParams={{
                q: list.q || undefined,
                region: list.region || undefined,
                status: list.status || undefined,
              }}
            />
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => pushList({ page: 1, q: searchValue.trim() })}
          >
            Search
          </Button>
          {list.q || list.region || list.status ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => {
                setSearchValue("");
                pushList({ page: 1, q: "", region: "", status: "" });
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Showing {from} to {to} of {list.totalCount} results
      </div>

      <ListBusyRegion
        label="schools"
        skeleton={<TableSectionSkeleton rows={8} columns={8} showToolbar={false} />}
      >
      <div
        className={cn(
          "hidden overflow-hidden rounded-xl border border-border/80 bg-card shadow-card",
          isAdminColumns ? "md:block" : "lg:block"
        )}
      >
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead>School Name</TableHead>
              <TableHead>School ID</TableHead>
              {isAdminColumns ? (
                <>
                  <TableHead>Region</TableHead>
                  <TableHead>Division</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Learners</TableHead>
                </>
              ) : (
                <TableHead>District</TableHead>
              )}
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {optimisticSchools.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdminColumns ? 8 : 5}
                  className="py-10 text-center text-muted-foreground"
                >
                  {caps.emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              optimisticSchools.map((school) => (
                <TableRow key={school.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={detailHref(school.id)}
                        prefetch={false}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {school.name}
                      </Link>
                      {school.isDemo ? (
                        <span
                          className="rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
                          title="Training data. Hidden from the login page except inside a demo session."
                        >
                          Demo
                        </span>
                      ) : null}
                      {caps.openAsSchoolHead ? (
                        <Link
                          href={`${SCHOOL_HEAD_ROUTES.dashboard}?schoolId=${school.id}`}
                          prefetch={true}
                          aria-label={`Open ${school.name} as School Head`}
                          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      {school.schoolIdCode}
                    </code>
                  </TableCell>
                  {isAdminColumns ? (
                    <>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {school.region || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {school.division || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{school.users}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{school.learners}</Badge>
                      </TableCell>
                    </>
                  ) : (
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {school.district || "—"}
                      </span>
                    </TableCell>
                  )}
                  <TableCell>
                    {school.isActive ? (
                      <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        aria-label={`${detailVerb} ${school.name}`}
                      >
                        <Link href={detailHref(school.id)} prefetch={false}>
                          <DetailIcon className="h-4 w-4" aria-hidden />
                        </Link>
                      </Button>
                      {caps.toggleActive ? (
                        <SchoolActiveToggle
                          schoolId={school.id}
                          isActive={school.isActive}
                          schoolName={school.name}
                          pending={actingId === school.id}
                          onToggle={(nextActive) => toggleActive(school, nextActive)}
                        />
                      ) : null}
                      {caps.resetHead ? (
                        <RegenButton
                          schoolId={school.id}
                          schoolName={school.name}
                          onCredential={setCredential}
                        />
                      ) : null}
                      {caps.delete ? (
                        <ConfirmAction
                          title="Remove this school?"
                          description={`${school.name} will be hidden from active lists. Existing data is kept and can be restored by support if needed.`}
                          confirmLabel="Remove"
                          variant="destructive"
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              className="text-destructive hover:text-destructive"
                              aria-label={`Remove ${school.name}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          }
                          onConfirm={async () => {
                            const fd = new FormData();
                            fd.set("id", school.id);
                            try {
                              await deleteSchool(fd);
                              toast.success("School removed");
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Could not remove school"
                              );
                              throw err;
                            }
                          }}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className={cn("space-y-3", isAdminColumns ? "md:hidden" : "lg:hidden")}>
        {optimisticSchools.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {caps.emptyMessage}
          </div>
        ) : (
          optimisticSchools.map((school) => (
            <article key={school.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={detailHref(school.id)}
                      prefetch={false}
                      className={cn(
                        "font-medium underline-offset-4 hover:underline",
                        !isAdminColumns && "max-lg:inline-flex max-lg:min-h-10 max-lg:items-center"
                      )}
                    >
                      {school.name}
                    </Link>
                    {school.isDemo ? (
                      <span className="rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
                        Demo
                      </span>
                    ) : null}
                  </div>
                  <code className="mt-1 inline-block rounded bg-muted px-1 py-0.5 text-xs">
                    {school.schoolIdCode}
                  </code>
                </div>
                {school.isActive ? (
                  <Badge className="shrink-0 bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
                ) : (
                  <Badge variant="secondary" className="shrink-0">Inactive</Badge>
                )}
              </div>
              {isAdminColumns ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Region</dt>
                    <dd className="mt-1 text-muted-foreground">{school.region || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Division</dt>
                    <dd className="mt-1 text-muted-foreground">{school.division || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Users</dt>
                    <dd className="mt-1"><Badge variant="secondary">{school.users}</Badge></dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Learners</dt>
                    <dd className="mt-1"><Badge variant="outline">{school.learners}</Badge></dd>
                  </div>
                </dl>
              ) : (
                <dl className="mt-4 grid grid-cols-1 gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">District</dt>
                    <dd className="mt-1 text-muted-foreground">{school.district || "—"}</dd>
                  </div>
                </dl>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-1 border-t pt-3">
                <Button asChild variant="ghost" size="sm" className={mobileTouch} aria-label={`${detailVerb} ${school.name}`}>
                  <Link href={detailHref(school.id)} prefetch={false}>
                    <DetailIcon className="h-4 w-4" aria-hidden />
                    {isAdminColumns ? <span className="sr-only">View</span> : <span>Edit</span>}
                  </Link>
                </Button>
                {caps.toggleActive ? (
                  <SchoolActiveToggle
                    schoolId={school.id}
                    isActive={school.isActive}
                    schoolName={school.name}
                    pending={actingId === school.id}
                    onToggle={(nextActive) => toggleActive(school, nextActive)}
                    className={mobileTouch}
                  />
                ) : null}
                {caps.resetHead ? (
                  <RegenButton
                    schoolId={school.id}
                    schoolName={school.name}
                    onCredential={setCredential}
                    className={isAdminColumns ? undefined : "size-11 sm:size-10"}
                  />
                ) : null}
                {caps.delete ? (
                  <ConfirmAction
                    title="Remove this school?"
                    description={`${school.name} will be hidden from active lists. Existing data is kept and can be restored by support if needed.`}
                    confirmLabel="Remove"
                    variant="destructive"
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Remove ${school.name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    }
                    onConfirm={async () => {
                      const fd = new FormData();
                      fd.set("id", school.id);
                      try {
                        await deleteSchool(fd);
                        toast.success("School removed");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not remove school");
                        throw err;
                      }
                    }}
                  />
                ) : null}
                {caps.openAsSchoolHead ? (
                  <Link
                    href={`${SCHOOL_HEAD_ROUTES.dashboard}?schoolId=${school.id}`}
                    prefetch={true}
                    className="ml-auto inline-flex min-h-10 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Open as School Head
                  </Link>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
      </ListBusyRegion>

      {list.totalPages > 1 ? (
        <SchoolsPager list={list} hrefFor={(l, page) => hrefFor(l, page, basePath)} />
      ) : null}
    </div>
  );
}
