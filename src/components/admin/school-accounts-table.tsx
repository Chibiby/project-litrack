"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmAction } from "@/components/confirm-action";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  LogIn,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  impersonateSchoolHead,
  resetSchoolHeadPasswordToDefault,
} from "@/lib/actions/school-accounts";
import type { SchoolAccountRow } from "@/lib/admin/school-accounts";

export type SchoolAccountsList = {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  q: string;
};

/**
 * The password cell.
 *
 * Shows a credential only in the one case where the system knows it: the
 * account's live password is the School ID, because LITRACK set it there
 * itself. A user's own password is a bcrypt hash inside Supabase Auth and
 * cannot be read back by anyone — so rather than pretend, the cell says so and
 * points at the reset that always works.
 *
 * Masked by default even though the School ID is printed in the column beside
 * it: what the mask protects is not the digits, it is shoulder-surfing a screen
 * that says "this string signs you in as this school".
 */
function PasswordCell({ row }: { row: SchoolAccountRow }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!row.head) {
    return <span className="text-sm text-muted-foreground">No account</span>;
  }

  if (!row.head.passwordIsSchoolId) {
    return (
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Custom password</p>
        <p className="text-xs text-muted-foreground">
          Not readable — reset to sign in
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <code
        className="rounded bg-muted px-2 py-1 font-mono text-sm tabular-nums"
        aria-label={
          revealed
            ? `Password for ${row.schoolName}: ${row.defaultPassword}`
            : `Password for ${row.schoolName} is hidden`
        }
      >
        {revealed ? row.defaultPassword : "•".repeat(Math.max(6, row.defaultPassword.length))}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-pressed={revealed}
        aria-label={revealed ? `Hide password for ${row.schoolName}` : `Show password for ${row.schoolName}`}
        title={revealed ? "Hide" : "Show"}
        onClick={() => setRevealed((v) => !v)}
      >
        {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </Button>
      {revealed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Copy password for ${row.schoolName}`}
          title={copied ? "Copied" : "Copy"}
          onClick={async () => {
            await navigator.clipboard.writeText(row.defaultPassword);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? (
            <Check className="h-4 w-4 text-primary" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
        </Button>
      ) : null}
    </div>
  );
}

function RowActions({ row }: { row: SchoolAccountRow }) {
  const [signingIn, startSignIn] = useTransition();

  if (!row.head) {
    return (
      <span className="text-xs text-muted-foreground">
        No School Head to act on
      </span>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <ConfirmAction
        title="Reset this password to the School ID?"
        description={`${row.schoolName}'s School Head will sign in with ${row.defaultPassword} until they choose a new password. Any password they set before this stops working immediately.`}
        confirmLabel="Reset password"
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Reset ${row.schoolName} password to the School ID`}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
            Reset
          </Button>
        }
        onConfirm={async () => {
          const fd = new FormData();
          fd.set("schoolId", row.schoolId);
          const res = await resetSchoolHeadPasswordToDefault(fd);
          if (!res.ok) {
            toast.error(res.error);
            throw new Error(res.error);
          }
          toast.success(`Password reset to ${res.data?.password ?? "the School ID"}`);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={signingIn}
        loadingText="Signing in…"
        aria-label={`Sign in as ${row.schoolName}'s School Head`}
        onClick={() => {
          startSignIn(async () => {
            const fd = new FormData();
            fd.set("schoolId", row.schoolId);
            const res = await impersonateSchoolHead(fd);
            // Success redirects into /school-head, so only a failure lands here.
            if (res && !res.ok) toast.error(res.error);
          });
        }}
      >
        <LogIn className="mr-1.5 h-4 w-4" aria-hidden />
        Sign in as
      </Button>
    </div>
  );
}

function hrefFor(list: SchoolAccountsList, page: number): string {
  const params = new URLSearchParams();
  if (list.q) params.set("q", list.q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/school-accounts?${qs}` : "/admin/school-accounts";
}

export function SchoolAccountsTable({
  rows,
  list,
}: {
  rows: SchoolAccountRow[];
  list: SchoolAccountsList;
}) {
  const router = useRouter();
  const [searchValue, setSearchValue] = useState(list.q);

  useEffect(() => {
    setSearchValue(list.q);
  }, [list.q]);

  const submitSearch = () => {
    const params = new URLSearchParams();
    const q = searchValue.trim();
    if (q) params.set("q", q);
    const qs = params.toString();
    router.push(qs ? `/admin/school-accounts?${qs}` : "/admin/school-accounts");
  };

  const from = list.totalCount > 0 ? (list.page - 1) * list.pageSize + 1 : 0;
  const to = Math.min(list.page * list.pageSize, list.totalCount);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search schools…"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
              }
            }}
            className="pl-9"
            aria-label="Search school accounts"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={submitSearch}>
          Search
        </Button>
      </div>

      <div className="text-sm text-muted-foreground">
        Showing {from} to {to} of {list.totalCount} accounts
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/80 bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 bg-muted/40 hover:bg-muted/40">
              <TableHead>School</TableHead>
              <TableHead>School Head login</TableHead>
              <TableHead>School ID</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No schools found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.schoolId}>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="font-medium">{row.schoolName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[row.division, row.region].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.head ? (
                      <div className="min-w-0">
                        <p className="truncate text-sm">{row.head.fullName}</p>
                        <code className="block truncate text-xs text-muted-foreground">
                          {row.head.email}
                        </code>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      {row.schoolIdCode}
                    </code>
                  </TableCell>
                  <TableCell>
                    <PasswordCell row={row} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.schoolIsActive ? (
                        <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                      {row.head?.mustChangePassword ? (
                        <Badge variant="outline">Prompted to set password</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <RowActions row={row} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {list.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button asChild variant="outline" size="sm" className="rounded-lg" disabled={list.page <= 1}>
            <Link
              href={hrefFor(list, list.page - 1)}
              className={list.page <= 1 ? "pointer-events-none opacity-50" : ""}
              aria-disabled={list.page <= 1}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
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
            disabled={list.page >= list.totalPages}
          >
            <Link
              href={hrefFor(list, list.page + 1)}
              className={list.page >= list.totalPages ? "pointer-events-none opacity-50" : ""}
              aria-disabled={list.page >= list.totalPages}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
