"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, KeyRound, Search } from "lucide-react";
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
import { EmptyState } from "@/components/dashboard/empty-state";
import { AccountRowActions, PasswordCell } from "@/components/admin/account-row-actions";
import { USER_ROLE_LABELS } from "@/lib/constants/enum-labels";
import type { AccountRow } from "@/lib/admin/accounts";
import type { UserRole } from "@prisma/client";

const ANY_ROLE = "any";
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "SUPER_ADMIN", label: USER_ROLE_LABELS.SUPER_ADMIN },
  { value: "SCHOOL_HEAD", label: USER_ROLE_LABELS.SCHOOL_HEAD },
  { value: "TEACHER", label: USER_ROLE_LABELS.TEACHER },
];

export type AccountsTableList = {
  page: number;
  totalPages: number;
  totalCount: number;
  role: string;
  schoolId: string;
  q: string;
};

function Paginator({
  page,
  pages,
  hrefFor,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <span className="text-sm text-muted-foreground">
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
          {page > 1 ? (
            <Link href={hrefFor(page - 1)}>
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
              Previous
            </Link>
          ) : (
            <span>
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
              Previous
            </span>
          )}
        </Button>
        <Button asChild={page < pages} variant="outline" size="sm" disabled={page >= pages}>
          {page < pages ? (
            <Link href={hrefFor(page + 1)}>
              Next
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
            </Link>
          ) : (
            <span>
              Next
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

function SignInCell({ row }: { row: AccountRow }) {
  if (row.signIn.kind === "username") {
    return <span className="text-sm">{row.signIn.value}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="break-all text-sm">{row.signIn.value}</span>
      {row.signIn.synthetic ? <Badge variant="outline">No mailbox</Badge> : null}
    </div>
  );
}

function StatusCell({ row }: { row: AccountRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={row.isActive ? "default" : "secondary"}>
        {row.isActive ? "Active" : "Inactive"}
      </Badge>
      {row.approvalStatus === "PENDING" ? <Badge variant="outline">Pending</Badge> : null}
      {row.approvalStatus === "REJECTED" ? <Badge variant="outline">Declined</Badge> : null}
      {row.mustChangePassword ? (
        <span className="text-xs text-muted-foreground">Must change password</span>
      ) : null}
    </div>
  );
}

/**
 * Super Admin's console for every account across every school — filters,
 * table, and pagination live in the URL so a bookmark or a back navigation
 * reproduces exactly what was on screen.
 *
 * No school picker: `schoolId` is honoured when present (a deep link from
 * `/admin/schools`) but is not exposed as a UI control here — the spec calls a
 * 333-school dropdown a large payload and a third query for a filter the text
 * search already serves.
 */
export function AccountsTable({
  rows,
  list,
}: {
  rows: AccountRow[];
  list: AccountsTableList;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(list.q);

  // `list.q` comes from the URL that produced this render, so it is the
  // source of truth on back/forward navigation — the input's own typed
  // state must follow it rather than freeze at whatever was last typed.
  useEffect(() => {
    setQuery(list.q);
  }, [list.q]);

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
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              apply({ q: query.trim() || null });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="accounts-role">Role</Label>
              <Select
                value={list.role || ANY_ROLE}
                onValueChange={(value) => apply({ role: value })}
                disabled={pending}
              >
                <SelectTrigger id="accounts-role" className="w-56">
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

            <div className="space-y-2">
              <Label htmlFor="accounts-q">Search</Label>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="accounts-q"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, email, or school"
                  className="pl-9"
                  disabled={pending}
                />
              </div>
            </div>

            <Button type="submit" loading={pending} loadingText="Searching…">
              Search
            </Button>
            {list.role || list.q || list.schoolId ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setQuery("");
                  router.push("/admin/accounts");
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Accounts
            <Badge variant="secondary">{list.totalCount}</Badge>
          </h2>

          {rows.length === 0 ? (
            <EmptyState
              title="No accounts match"
              description="Try clearing the search or role filter."
              icon={KeyRound}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead>Sign-in</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Password</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">{row.fullName}</span>
                            <Badge variant="outline" className="w-fit">
                              {USER_ROLE_LABELS[row.role]}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.school ? (
                            <div className="flex flex-col">
                              <span>{row.school.name}</span>
                              <span className="text-xs">{row.school.schoolIdCode}</span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <SignInCell row={row} />
                        </TableCell>
                        <TableCell>
                          <StatusCell row={row} />
                        </TableCell>
                        <TableCell>
                          <PasswordCell row={row} />
                        </TableCell>
                        <TableCell className="text-right">
                          <AccountRowActions row={row} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Paginator page={list.page} pages={list.totalPages} hrefFor={hrefFor} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
