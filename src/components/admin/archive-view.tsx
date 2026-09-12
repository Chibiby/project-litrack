"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive as ArchiveIcon, ChevronLeft, ChevronRight, GraduationCap, Users } from "lucide-react";
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
import { LearnerRowActions, TeacherRowActions } from "@/components/admin/archive-row-actions";
import type { Archive } from "@/lib/admin/archive";
import { cn } from "@/lib/utils";

export interface ArchiveSchoolOption {
  id: string;
  name: string;
}

const ANY_SCHOOL = "any";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
  });
}

/** School name, struck through when the row's own school is itself removed. */
function SchoolCell({ name, deleted }: { name: string | null; deleted: boolean }) {
  return (
    <span className={cn(deleted && "text-muted-foreground line-through")}>
      {name ?? "—"}
    </span>
  );
}

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

/**
 * The Super Admin's view across every school: every soft-deleted Teacher and
 * Learner, restore or permanently delete one row at a time.
 *
 * Filters (`school`, `q`) and both paginators (`teachers`, `learners`) live in
 * the URL, so a link into this page — or a browser back — reproduces exactly
 * what was on screen.
 */
export function ArchiveView({
  data,
  schools,
  filters,
}: {
  data: Archive;
  schools: ArchiveSchoolOption[];
  filters: { school: string; q: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);

  // `schools` only lists ids present in *this* filtered result, so narrowing
  // the search can make the currently selected school disappear from the
  // option list — which would blank the Select even though it still has a
  // value. Accumulate every school id/name this session has seen (across
  // filter changes) in a ref so a selection never falls out of its own
  // dropdown; mutated during render rather than an effect since it is
  // idempotent and must be visible in the same pass that reads it.
  const seenSchoolsRef = useRef<Map<string, string>>(new Map());
  for (const school of schools) seenSchoolsRef.current.set(school.id, school.name);
  if (filters.school && !seenSchoolsRef.current.has(filters.school)) {
    seenSchoolsRef.current.set(filters.school, filters.school);
  }
  const schoolOptions = useMemo(
    () =>
      Array.from(seenSchoolsRef.current, ([id, name]) => ({ id, name })).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref content, keyed off the inputs that mutate it
    [schools, filters.school]
  );

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY_SCHOOL) next.delete(key);
      else next.set(key, value);
    }
    // A filter change invalidates both paginators' current pages.
    if ("school" in changes || "q" in changes) {
      next.delete("teachers");
      next.delete("learners");
    }
    startTransition(() => router.push(`/admin/archive?${next.toString()}`));
  };

  const teacherHref = (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("teachers", String(page));
    return `/admin/archive?${next.toString()}`;
  };
  const learnerHref = (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("learners", String(page));
    return `/admin/archive?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
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
              <Label htmlFor="archive-school">School</Label>
              <Select
                value={filters.school || ANY_SCHOOL}
                onValueChange={(value) => apply({ school: value })}
                disabled={pending}
              >
                <SelectTrigger id="archive-school" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_SCHOOL}>All schools</SelectItem>
                  {schoolOptions.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="archive-q">Search name</Label>
              <Input
                id="archive-q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Learner or teacher name"
                className="w-56"
                disabled={pending}
              />
            </div>

            <Button type="submit" loading={pending} loadingText="Searching…">
              Search
            </Button>
            {filters.school || filters.q ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setQuery("");
                  apply({ school: null, q: null });
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
            <Users className="h-5 w-5" aria-hidden />
            Removed teachers
            <Badge variant="secondary">{data.teachers.total}</Badge>
          </h2>

          {data.teachers.rows.length === 0 ? (
            <EmptyState
              title="No removed teachers"
              description="Teacher accounts that have been removed will appear here."
              icon={ArchiveIcon}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead>Removed on</TableHead>
                      <TableHead>Original email</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.teachers.rows.map((teacher) => (
                      <TableRow key={teacher.id}>
                        <TableCell className="font-medium">{teacher.fullName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <SchoolCell name={teacher.schoolName} deleted={teacher.schoolDeleted} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(teacher.deletedAt)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {teacher.originalEmail ?? "Not recoverable"}
                        </TableCell>
                        <TableCell className="text-right">
                          <TeacherRowActions teacher={teacher} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Paginator page={data.teachers.page} pages={data.teachers.pages} hrefFor={teacherHref} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <GraduationCap className="h-5 w-5" aria-hidden />
            Removed learners
            <Badge variant="secondary">{data.learners.total}</Badge>
          </h2>

          {data.learners.rows.length === 0 ? (
            <EmptyState
              title="No removed learners"
              description="Learners that have been removed will appear here."
              icon={ArchiveIcon}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>Removed on</TableHead>
                      <TableHead>ARAL</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.learners.rows.map((learner) => (
                      <TableRow key={learner.id}>
                        <TableCell className="font-medium">{learner.fullName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <SchoolCell name={learner.schoolName} deleted={learner.schoolDeleted} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {learner.gradeLevel}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {learner.section ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(learner.deletedAt)}
                        </TableCell>
                        <TableCell>
                          {learner.isAralLearner ? (
                            <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300">
                              ARAL
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <LearnerRowActions learner={learner} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Paginator page={data.learners.page} pages={data.learners.pages} hrefFor={learnerHref} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
