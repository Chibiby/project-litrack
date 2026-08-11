"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  GENDER_LABELS,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";
import { LearnerArchiveButton } from "@/components/learners/learner-archive-button";
import {
  LearnerListToolbar,
  type LearnerGradeOption,
  type LearnerListAddLearnerProps,
  type SectionOption,
} from "@/components/learners/learner-list-toolbar";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { EmptyState } from "@/components/dashboard";
import {
  LEARNER_PAGE_SIZE,
  totalPages as calcTotalPages,
  type LearnerListFilter,
  type LearnerListGradeFilter,
  type LearnerListSectionFilter,
  type LearnerListSort,
} from "@/lib/learners/pagination";
import { Eye, Pencil } from "lucide-react";
import { archiveLearner, restoreLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

/** Debounce pause before applying typed search (ms). */
export const SEARCH_DEBOUNCE_MS = 500;

export type LearnerListRow = {
  id: string;
  fullName: string;
  age: number;
  gender: keyof typeof GENDER_LABELS;
  isAralLearner: boolean;
  archivedAt: string | null;
  englishReadingProfile: string;
  filipinoReadingProfile: string;
  section: { id: string; name: string } | null;
  /** Grade owning this learner — used for detail/edit links in multi-grade lists. */
  gradeLevelId: string;
  gradeType: string;
};

export type LearnerListClientProps = {
  /** List route base — defaults to `/teacher/learners`. */
  basePath?: string;
  filter: LearnerListFilter;
  sort: LearnerListSort;
  grade?: LearnerListGradeFilter;
  section: LearnerListSectionFilter;
  grades?: LearnerGradeOption[];
  sections: SectionOption[];
  schoolId?: string;
  isSuperAdmin: boolean;
  /** Current page rows from the server (already filtered/paginated). */
  learners: LearnerListRow[];
  page: number;
  totalCount: number;
  q: string;
  /** When set, mounts Add learner in the toolbar (teachers only). */
  addLearner?: LearnerListAddLearnerProps | null;
};

type LearnerOp = ListOptimisticOp<LearnerListRow>;

export function LearnerListClient({
  basePath = "/teacher/learners",
  filter,
  sort,
  grade = "all",
  section,
  grades = [],
  sections,
  schoolId,
  isSuperAdmin,
  learners,
  page,
  totalCount,
  q,
  addLearner = null,
}: LearnerListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();
  const [optimisticLearners, dispatchOptimistic] = useOptimistic(
    learners,
    (state: LearnerListRow[], op: LearnerOp) => listOptimisticReducer(state, op)
  );

  useEffect(() => {
    setInputValue(q);
  }, [q]);

  const clearDebounce = () => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  useEffect(() => () => clearDebounce(), []);

  const pushSearch = (raw: string) => {
    clearDebounce();
    const next = raw.trim();
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const handleSearchChange = (value: string) => {
    setInputValue(value);
    clearDebounce();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      pushSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSearchSubmit = () => {
    pushSearch(inputValue);
  };

  const pages = calcTotalPages(totalCount, LEARNER_PAGE_SIZE);
  const showGradeColumn = grades.length > 1;
  const showSection = sections.length > 0;
  const gradeLabelById = Object.fromEntries(grades.map((g) => [g.id, g.label]));

  const resolvedAddLearner: LearnerListAddLearnerProps | null =
    !isSuperAdmin && addLearner
      ? {
          ...addLearner,
          gradeLevelId:
            grade !== "all" &&
            addLearner.grades.some((g) => g.id === grade)
              ? grade
              : addLearner.gradeLevelId || addLearner.grades[0]?.id || "",
        }
      : null;

  const pageSearchParams: Record<string, string | undefined> = {
    q: q.trim() || undefined,
    filter: filter !== "all" ? filter : undefined,
    sort: sort !== "name" ? sort : undefined,
    grade: grade !== "all" ? grade : undefined,
    section: section !== "all" ? section : undefined,
    schoolId,
  };

  const changeArchive = (row: LearnerListRow) =>
    runOptimistic(startTransition, async () => {
      // Leaving the current list filter: remove the row immediately.
      dispatchOptimistic({ type: "remove", id: row.id });
      const fd = new FormData();
      fd.set("id", row.id);
      if (row.archivedAt) {
        const res = await restoreLearner(fd);
        await settleActionResult(res, "Learner restored");
      } else {
        const res = await archiveLearner(fd);
        await settleActionResult(res, "Learner archived");
      }
      invalidateNavWarm();
    });

  return (
    <Card>
      <LearnerListToolbar
        basePath={basePath}
        filter={filter}
        sort={sort}
        grade={grade}
        section={section}
        grades={grades}
        sections={sections}
        schoolId={schoolId}
        q={q}
        searchValue={inputValue}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        addLearner={
          resolvedAddLearner?.gradeLevelId ? resolvedAddLearner : null
        }
      />
      <CardContent className="p-0">
        {totalCount === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                q.trim()
                  ? "No matching learners"
                  : filter === "archived"
                    ? "No archived learners"
                    : section !== "all"
                      ? "No learners in this section"
                      : "No learners yet"
              }
              description={
                q.trim()
                  ? "Try a different name search."
                  : filter === "archived"
                    ? "Archived learners will appear here."
                    : section !== "all"
                      ? "Try another section or grade filter."
                      : resolvedAddLearner
                        ? "Add a learner using the button on the right."
                        : "Learners in your assigned grades will appear here."
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Gender</TableHead>
                {showGradeColumn && <TableHead>Grade</TableHead>}
                {showSection && <TableHead>Section</TableHead>}
                <TableHead>English</TableHead>
                <TableHead>Filipino</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optimisticLearners.map((l) => {
                const readingLabels = readingProfileLabelsForGradeType(
                  l.gradeType
                );
                return (
                  <TableRow
                    key={l.id}
                    className={l.archivedAt ? "opacity-70" : undefined}
                  >
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {l.fullName}
                        {l.isAralLearner && <Badge variant="violet">ARAL</Badge>}
                        {l.archivedAt && (
                          <Badge variant="outline">Archived</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{l.age}</TableCell>
                    <TableCell>{GENDER_LABELS[l.gender]}</TableCell>
                    {showGradeColumn && (
                      <TableCell className="text-sm text-muted-foreground">
                        {gradeLabelById[l.gradeLevelId] ?? "—"}
                      </TableCell>
                    )}
                    {showSection && (
                      <TableCell className="text-sm text-muted-foreground">
                        {l.section?.name ?? "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-xs">
                      {readingLabels[
                        l.englishReadingProfile as keyof typeof readingLabels
                      ] ?? l.englishReadingProfile}
                    </TableCell>
                    <TableCell className="text-xs">
                      {readingLabels[
                        l.filipinoReadingProfile as keyof typeof readingLabels
                      ] ?? l.filipinoReadingProfile}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button asChild size="sm" variant="ghost">
                          <Link
                            href={`/teacher/grade/${l.gradeLevelId}/learners/${l.id}`}
                          >
                            <Eye className="h-4 w-4" />
                            View profile
                          </Link>
                        </Button>
                        {!l.archivedAt && (
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={`/teacher/grade/${l.gradeLevelId}/learners/${l.id}/edit`}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Link>
                          </Button>
                        )}
                        {!isSuperAdmin && (
                          <LearnerArchiveButton
                            learnerId={l.id}
                            archived={Boolean(l.archivedAt)}
                            pending={pending}
                            onArchiveChange={() => changeArchive(l)}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <LearnerPagination
          basePath={basePath}
          page={page}
          totalPages={pages}
          searchParams={pageSearchParams}
        />
      </CardContent>
    </Card>
  );
}
