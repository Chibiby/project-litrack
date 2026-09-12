"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  GraduationCap,
  KeyRound,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  AccountRowActions,
  PasswordCell,
} from "@/components/admin/account-row-actions";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { AccountRow, AccountSummary } from "@/lib/admin/accounts";
import { USER_ROLE_LABELS } from "@/lib/constants/enum-labels";
import type { UserRole } from "@prisma/client";

const ANY_ROLE = "any";
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "SUPER_ADMIN", label: USER_ROLE_LABELS.SUPER_ADMIN },
  { value: "SCHOOL_HEAD", label: USER_ROLE_LABELS.SCHOOL_HEAD },
  { value: "TEACHER", label: USER_ROLE_LABELS.TEACHER },
];

export type AccountsTableList = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  role: string;
  schoolId: string;
  q: string;
};

function Paginator({
  page,
  pageSize,
  pages,
  totalCount,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  pages: number;
  totalCount: number;
  hrefFor: (page: number) => string;
}) {
  const firstItem = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalCount);
  const canGoBack = page > 1;
  const canGoForward = page < pages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3 sm:px-4">
      <span className="text-xs text-muted-foreground">
        Showing {firstItem}–{lastItem} of {totalCount.toLocaleString()} accounts
      </span>
      <nav className="flex items-center gap-1" aria-label="Account pages">
        <Button
          asChild={canGoBack}
          variant="ghost"
          size="icon"
          disabled={!canGoBack}
          aria-label="Previous page"
        >
          {canGoBack ? (
            <Link href={hrefFor(page - 1)}>
              <ChevronLeft aria-hidden />
            </Link>
          ) : (
            <span>
              <ChevronLeft aria-hidden />
            </span>
          )}
        </Button>
        <span className="min-w-14 text-center text-xs font-medium text-muted-foreground">
          {page} / {pages}
        </span>
        <Button
          asChild={canGoForward}
          variant="ghost"
          size="icon"
          disabled={!canGoForward}
          aria-label="Next page"
        >
          {canGoForward ? (
            <Link href={hrefFor(page + 1)}>
              <ChevronRight aria-hidden />
            </Link>
          ) : (
            <span>
              <ChevronRight aria-hidden />
            </span>
          )}
        </Button>
      </nav>
    </div>
  );
}

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

function AccountOverview({ summary }: { summary?: AccountSummary }) {
  if (!summary) return null;
  const cards = [
    {
      label: "Total accounts",
      value: summary.totalCount,
      icon: Users,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "Active accounts",
      value: summary.activeCount,
      icon: CircleCheck,
      tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Inactive accounts",
      value: summary.inactiveCount,
      icon: CircleX,
      tone: "bg-muted text-muted-foreground",
    },
    {
      label: "School Heads",
      value: summary.schoolHeadCount,
      icon: ShieldCheck,
      tone: "bg-violet-soft text-violet-soft-foreground",
    },
    {
      label: "Teachers",
      value: summary.teacherCount,
      icon: GraduationCap,
      tone: "bg-primary/10 text-primary",
    },
  ];
  return (
    <section
      aria-label="Account overview"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
    >
      {cards.map(({ label, value, icon: Icon, tone }) => (
        <Card key={label} className="shadow-none">
          <CardContent className="flex items-center gap-3 p-4">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-full ${tone}`}
            >
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-bold leading-none tabular-nums">
                {value.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

export function AccountsTable({
  rows,
  summary,
  list,
}: {
  rows: AccountRow[];
  summary?: AccountSummary;
  list: AccountsTableList;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(list.q);

  useEffect(() => setQuery(list.q), [list.q]);

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY_ROLE) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    startTransition(() => router.push(`/admin/accounts?${next.toString()}`));
  };

  const hrefFor = (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    return `/admin/accounts?${next.toString()}`;
  };

  return (
    <div className="space-y-3">
      <AccountOverview summary={summary} />
      <Card className="shadow-none">
        <CardContent className="p-3 sm:p-4">
          <form
            className="grid gap-3 lg:grid-cols-[minmax(13rem,1.25fr)_minmax(11rem,0.8fr)_auto] lg:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              apply({ q: query.trim() || null });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="accounts-q" className="text-xs font-medium">
                Search accounts
              </Label>
              <div className="relative w-full">
                <Search
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="accounts-q"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, email, or school..."
                  className="h-10 pl-9"
                  disabled={pending}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="accounts-role" className="text-xs font-medium">
                Role
              </Label>
              <Select
                value={list.role || ANY_ROLE}
                onValueChange={(value) => apply({ role: value })}
                disabled={pending}
              >
                <SelectTrigger id="accounts-role" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_ROLE}>All roles</SelectItem>
                  {ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                className="h-10 flex-1 lg:flex-none"
                loading={pending}
                loadingText="Searching…"
              >
                Search
              </Button>
              {list.role || list.q || list.schoolId ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 flex-1 lg:flex-none"
                  disabled={pending}
                  onClick={() => {
                    setQuery("");
                    router.push("/admin/accounts");
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="overflow-hidden shadow-none">
        <CardContent className="space-y-3 p-0">
          <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
            <h2 className="text-base font-semibold">
              Accounts{" "}
              <span className="text-muted-foreground">
                ({list.totalCount.toLocaleString()})
              </span>
            </h2>
            <span className="text-xs text-muted-foreground">
              Page {list.page} of {list.totalPages}
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="px-4 pb-4">
              <EmptyState
                title="No accounts match"
                description="Try clearing the search or role filter."
                icon={KeyRound}
              />
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4 text-xs">Name</TableHead>
                      <TableHead className="text-xs">Role</TableHead>
                      <TableHead className="text-xs">School</TableHead>
                      <TableHead className="text-xs">Email / sign-in</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Password</TableHead>
                      <TableHead className="pr-4 text-right text-xs">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="py-2.5 pl-4">
                          <span className="text-sm font-medium">
                            {row.fullName}
                          </span>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge
                            variant="outline"
                            className="w-fit border-primary/15 bg-primary/10 text-primary dark:border-primary/30"
                          >
                            {USER_ROLE_LABELS[row.role]}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5 text-sm text-muted-foreground">
                          {row.school ? (
                            <div className="flex flex-col">
                              <span>{row.school.name}</span>
                              <span className="text-xs">
                                {row.school.schoolIdCode}
                              </span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <SignInCell row={row} />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <StatusCell row={row} />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <PasswordCell row={row} />
                        </TableCell>
                        <TableCell className="py-2.5 pr-4 text-right">
                          <AccountRowActions row={row} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 px-3 pb-1 md:hidden">
                {rows.map((row) => (
                  <article
                    key={row.id}
                    className="rounded-xl border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium">{row.fullName}</h3>
                        <Badge variant="outline" className="mt-1">
                          {USER_ROLE_LABELS[row.role]}
                        </Badge>
                      </div>
                      <StatusCell row={row} />
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-xs font-medium text-muted-foreground">
                          School
                        </dt>
                        <dd className="mt-1 truncate">
                          {row.school
                            ? `${row.school.name} · ${row.school.schoolIdCode}`
                            : "—"}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs font-medium text-muted-foreground">
                          Sign-in
                        </dt>
                        <dd className="mt-1">
                          <SignInCell row={row} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground">
                          Password
                        </dt>
                        <dd className="mt-1">
                          <PasswordCell row={row} />
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 border-t pt-3">
                      <AccountRowActions row={row} />
                    </div>
                  </article>
                ))}
              </div>
              <Paginator
                page={list.page}
                pageSize={list.pageSize}
                pages={list.totalPages}
                totalCount={list.totalCount}
                hrefFor={hrefFor}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
